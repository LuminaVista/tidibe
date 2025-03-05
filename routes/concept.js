import express from 'express';
import connection from '../connectiondb.js';
import authenticate from '../middlewares/authenticate.js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { businessIdea } from './businessIdea.js';


dotenv.config();
const concept = express.Router();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY // Ensure you have your API key set in environment variables
});



concept.get('/ai/answer/:business_idea_id/:concept_cat_id', authenticate, async (req, res) => {

    try {
        let { business_idea_id, concept_cat_id } = req.params;
        const userId = req.user.user_id;
        concept_cat_id = parseInt(req.params.concept_cat_id, 10);

        // get the category name
        const [category_name] = await connection.execute(
            `SELECT category_name from Concept_Categories where concept_cat_id = ?`,
            [concept_cat_id]
        );
        if (category_name.length === 0) {
            return res.status(404).json({ message: 'No Category Name found' });
        }

        let categoryName = category_name[0]["category_name"];

        // 1. Get the business idea details
        const [businessIdeas] = await connection.execute(
            `SELECT * FROM Business_Ideas WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (businessIdeas.length === 0) {
            return res.status(404).json({ message: 'No business idea found for the given business_id' });
        }
        const businessIdea = businessIdeas[0];

        // 2. Get the concept_id for the given business_id
        const [concepts] = await connection.execute(
            `SELECT concept_id FROM Concept WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (concepts.length === 0) {
            return res.status(404).json({ message: 'No concept found for the given business_id' });
        }
        const conceptId = concepts[0].concept_id;

        // 3. Check if answers already exist in the database
        const [existingAnswers] = await connection.execute(
            `SELECT cq.question, ca.answer, ca.concept_question_id, ca.concept_id, ca.concept_cat_id
         FROM Concept_Answers ca
         JOIN Concept_Questions cq ON ca.concept_question_id = cq.concept_question_id
         WHERE ca.concept_id = ? AND ca.concept_cat_id = ?`,
            [conceptId, concept_cat_id]
        );

        // If answers exist, return them
        if (existingAnswers.length > 0) {
            return res.json({
                message: 'Retrieved existing answers',
                category_name: categoryName,
                answers: existingAnswers
            });
        }





        // 4. If no answers exist, get questions and generate new answers
        const [questions] = await connection.execute(
            `SELECT concept_question_id, question FROM Concept_Questions WHERE concept_cat_id = ?`,
            [concept_cat_id]
        );
        if (questions.length === 0) {
            return res.status(404).json({ message: 'No questions found' });
        }

        // 5. Call OpenAI API for each question
        let answers = [];
        for (let q of questions) {
            const ai_prompt = `
          You are a Senior Business Consultant analyzing a business idea. Analyze the following business details:
          - Business Idea Name: ${businessIdea["idea_name"]}
          - Idea foundation: ${businessIdea["idea_foundation"]}
          - Problem statement: ${businessIdea["problem_statement"]}
          - Unique solution: ${businessIdea["unique_solution"]}
          - Target location: ${businessIdea["target_location"]}
          Question to answer: ${q.question}
          IMPORTANT INSTRUCTIONS:
          1. Respond ONLY with 4 bullet points
          2. Do not include any introduction, conclusion, or additional text
          3. Start each point with a dash (-)
          4. Keep each bullet point concise, direct, and professional
          5. Ensure all points directly address the question asked
        `;
            const response = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [{ role: "user", content: ai_prompt }]
            });
            answers.push({
                question: q.question,
                concept_question_id: q.concept_question_id,
                concept_id: conceptId,
                concept_cat_id: concept_cat_id,
                answer: response.choices[0].message.content,
                userId,
            });
        }

        // 6. Store the answers in the database
        for (let answer of answers) {
            await connection.execute(
                `INSERT INTO Concept_Answers (concept_question_id, concept_id, concept_cat_id, answer)
           VALUES (?, ?, ?, ?);`,
                [answer.concept_question_id, answer.concept_id, answer.concept_cat_id, answer.answer]
            );
        }

        return res.json({
            message: 'New answers generated and stored successfully',
            category_name: categoryName,
            answers: answers
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// AI Task generation
concept.get('/ai/task/generate/:business_idea_id', authenticate, async (req, res) => {
    try {
        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);
        const userId = req.user.user_id;

        // Get the business idea details
        const [businessIdeas] = await connection.execute(
            `SELECT * FROM Business_Ideas WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (businessIdeas.length === 0) {
            return res.status(404).json({ message: 'No business idea found for the given business_id' });
        }
        const businessIdea = businessIdeas[0];

        // Get the concept_id for the given business_id
        const [concepts] = await connection.execute(
            `SELECT concept_id FROM Concept WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (concepts.length === 0) {
            return res.status(404).json({ message: 'No concept found for the given business_id' });
        }
        const conceptId = concepts[0].concept_id;

        // Check if tasks already exist for this concept
        const [existingTasks] = await connection.execute(
            `SELECT concept_task_id, task_description, task_status FROM Concept_Tasks WHERE concept_id = ? AND business_idea_id = ?;`,
            [conceptId, business_idea_id]
        );

        if (existingTasks.length > 0) {
            // Return existing tasks in structured format
            return res.status(200).json({
                business_idea_id: business_idea_id,
                concept_id: conceptId,
                tasks: existingTasks.map(task => ({
                    id: task.concept_task_id,
                    task_description: task.task_description,
                    task_status: task.task_status
                }))
            });
        }

        // Get all questions and answers for the given concept_id  
        const [questionsAndAnswers] = await connection.execute(
            `SELECT cq.concept_question_id, cq.question, ca.answer  
             FROM Concept_Questions cq  
             LEFT JOIN Concept_Answers ca ON cq.concept_question_id = ca.concept_question_id  
             WHERE ca.concept_id = ?;`,
            [conceptId]
        );

        if (questionsAndAnswers.length === 0) {
            return res.status(404).json({ message: 'AI-generated feedbacks are required for generating Actions' });
        }

        // AI Prompt for Task Generation
        let ai_prompt_task_generation = `
        You are a Senior Business Consultant. A business idea has been given to you below:

        - Business Idea Name: ${businessIdea["idea_name"]}
        - Idea foundation: ${businessIdea["idea_foundation"]}
        - Problem statement: ${businessIdea["problem_statement"]}
        - Unique solution: ${businessIdea["unique_solution"]}
        - Target location: ${businessIdea["target_location"]}

        Along with the business idea, some business concept-related questions and answers are provided:

        - ${questionsAndAnswers.map(q => `Q: ${q.question} A: ${q.answer}`).join("\n")}

        Analyze the idea and generate THREE TASKS.

        IMPORTANT INSTRUCTIONS:
        1. Respond ONLY with 3 TASKS in bullet points.
        2. Do not include any introduction, conclusion, or additional text.
        3. Start each task with a dash (-).
        4. Keep each task point concise, direct, and professional.
        5. Ensure all tasks directly address the business idea and provided Q&A.
        `;

        const ai_response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: "user", content: ai_prompt_task_generation }]
        });

        let generated_task = ai_response.choices[0].message.content;
        
        // Convert AI response into task list
        let taskList = generated_task.split("\n")
            .map(task => task.replace("- ", "").trim())
            .filter(task => task.length > 0);

        let insertedTasks = [];

        // Insert each task into the database and get back the task ID
        for (let task of taskList) {
            const [result] = await connection.execute(
                `INSERT INTO Concept_Tasks (concept_id, business_idea_id, task_description, task_status) 
                 VALUES (?, ?, ?, FALSE)`,
                [conceptId, business_idea_id, task]
            );

            insertedTasks.push({
                id: result.insertId, // Get auto-generated ID
                task_description: task,
                task_status: false
            });
        }

        // updated response format
        return res.status(200).json({
            business_idea_id: business_idea_id,
            concept_id: conceptId,
            tasks: insertedTasks.map(task => ({
                id: task.id,
                task_description: task.task_description,
                task_status: task.task_status ? 1 : 0 // Convert boolean to int (0 or 1)
            }))
        });

    } catch (error) {
        console.error("Error generating AI task:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

// user generated task: add task
concept.post("/task/add/:business_idea_id", authenticate, async(req,res)=>{
    try{

        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);
        const { task_description } = req.body; // User provides only task_description
        const userId = req.user.user_id;

        // Validate input
        if (!task_description || task_description.trim() === "") {
            return res.status(400).json({ message: "Task description is required." });
        }

        // Check if the business idea exists
        const [businessIdeas] = await connection.execute(
            `SELECT * FROM Business_Ideas WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (businessIdeas.length === 0) {
            return res.status(404).json({ message: "No business idea found for the given business_idea_id." });
        }

        // Fetch the concept_id associated with the given business_idea_id
        const [concepts] = await connection.execute(
            `SELECT concept_id FROM Concept WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (concepts.length === 0) {
            return res.status(404).json({ message: "No concept found for the given business_idea_id." });
        }
        const conceptId = concepts[0].concept_id;

        // Insert the user-generated task into the database
        const [result] = await connection.execute(
            `INSERT INTO Concept_Tasks (concept_id, business_idea_id, task_description, task_status) 
             VALUES (?, ?, ?, FALSE);`,
            [conceptId, business_idea_id, task_description]
        );

        // Return the newly added task
        return res.status(201).json({
            message: "Task added successfully.",
            task: {
                id: result.insertId,
                concept_id: conceptId,
                business_idea_id: business_idea_id,
                task_description: task_description,
                task_status: 0 // Default status is 0 (incomplete)
            }
        });

    }catch(error){
        console.error("Error adding user-generated task:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});

// edit task status 
concept.put('/task/edit/:business_idea_id/:task_id', authenticate, async(req, res) =>{

    try{

        let { business_idea_id, task_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);
        task_id = parseInt(task_id, 10);
        const userId = req.user.user_id;

        // Check if the task exists
        const [task] = await connection.execute(
            `SELECT * FROM Concept_Tasks WHERE business_idea_id = ? AND concept_task_id = ?;`,
            [business_idea_id, task_id]
        );

        if (task.length === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        // Update task status to 'complete' (1)
        await connection.execute(
            `UPDATE Concept_Tasks SET task_status = 1 WHERE business_idea_id = ? AND concept_task_id = ?;`,
            [business_idea_id, task_id]
        );

        // Get concept_id from the task
        const concept_id = task[0].concept_id;
        // Update Concept Progress
        await updateConceptProgress(concept_id);
        // Update Business Stage Progress
        await updateBusinessStageProgress(business_idea_id);
        // Update Business Idea Progress
        await updateBusinessIdeaProgress(business_idea_id);

        return res.status(200).json({ 
            task_id: task_id,
            message: "Task marked as complete successfully" 
        });


    }catch(error){
        console.error("Task Edit Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }

});


concept.get('/concept_categories/:business_idea_id', authenticate, async (req, res) => {

    try {
        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);


        const [categories] = await connection.query(
            `SELECT 
                    Concept.concept_id,
                    Concept_Categories.concept_cat_id, 
                    Concept_Categories.category_name
                FROM Concept
                JOIN Concept_Categories_Conncect ON Concept.concept_id = Concept_Categories_Conncect.concept_id
                JOIN Concept_Categories ON Concept_Categories_Conncect.concept_cat_id = Concept_Categories.concept_cat_id
                WHERE Concept.business_idea_id = ?;`, [business_idea_id]);

        const [progress] = await connection.query(
            `select progress from Concept where business_idea_id = ?`, [business_idea_id]
        );
        return res.json({
            "progress": progress[0].progress,
            "categories": categories,
            business_idea_id: business_idea_id
        });


    } catch (error) {
        console.error("Error fetching concept categories:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});





// helper
/*
{todo: Take these functions below and put them in the conceptService File}
*/
// Function to update Concept progress
async function updateConceptProgress(concept_id) {
    const [[{ total_tasks }]] = await connection.execute(
        `SELECT COUNT(*) AS total_tasks FROM Concept_Tasks WHERE concept_id = ?;`,
        [concept_id]
    );

    const [[{ completed_tasks }]] = await connection.execute(
        `SELECT COUNT(*) AS completed_tasks FROM Concept_Tasks WHERE concept_id = ? AND task_status = 1;`,
        [concept_id]
    );

    const progress = total_tasks > 0 ? (completed_tasks / total_tasks) * 100 : 0;

    await connection.execute(
        `UPDATE Concept SET progress = ? WHERE concept_id = ?;`,
        [progress, concept_id]
    );
}

// Function to update Business Stage progress
async function updateBusinessStageProgress(business_idea_id) {
    const [concepts] = await connection.execute(
        `SELECT concept_id FROM Concept WHERE business_idea_id = ?;`,
        [business_idea_id]
    );

    if (concepts.length === 0) return;

    let totalProgress = 0;
    for (const concept of concepts) {
        const [[{ progress }]] = await connection.execute(
            `SELECT progress FROM Concept WHERE concept_id = ?;`,
            [concept.concept_id]
        );
        totalProgress += progress;
    }

    const avgProgress = totalProgress / concepts.length;

    // Update Business_Stages table for stage_id = 1 (Concept Stage)
    await connection.execute(
        `UPDATE Business_Stages SET progress = ? WHERE business_idea_id = ? AND stage_id = 1;`,
        [avgProgress, business_idea_id]
    );
}


// Function to update Business Idea progress
async function updateBusinessIdeaProgress(business_idea_id) {
    const [[{ avg_stage_progress }]] = await connection.execute(
        `SELECT AVG(progress) AS avg_stage_progress FROM Business_Stages WHERE business_idea_id = ?;`,
        [business_idea_id]
    );

    await connection.execute(
        `UPDATE Business_Ideas SET idea_progress = ? WHERE business_idea_id = ?;`,
        [avg_stage_progress, business_idea_id]
    );
}


export { concept }
