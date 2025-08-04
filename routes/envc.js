import express from 'express';
import { pool } from '../connectiondb.js';
import authenticate from '../middlewares/authenticate.js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { businessIdea } from './businessIdea.js';


dotenv.config();
const envc = express.Router();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// AI answer generation
envc.get('/ai/answer/:business_idea_id/:envc_cat_id', authenticate, async (req, res) => {

    let connection;

    try {
        let { business_idea_id, envc_cat_id } = req.params;
        const userId = req.user.user_id;
        envc_cat_id = parseInt(req.params.envc_cat_id, 10);

        // Get a connection from the pool
        connection = await pool.getConnection();

        // get the category name - envc
        const [category_name] = await connection.execute(
            `SELECT category_name from Envc_Categories where envc_cat_id = ?`,
            [envc_cat_id]
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

        // 2. Get the envc_id for the given business_id
        const [envcs] = await connection.execute(
            `SELECT envc_id FROM Envc WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (envcs.length === 0) {
            return res.status(404).json({ message: 'No Envc found for the given business_id' });
        }
        const envcId = envcs[0].envc_id;

        // 3. Check if answers already exist in the database
        const [existingAnswers] = await connection.execute(
            `SELECT eq.question, ea.answer, ea.envc_question_id, ea.envc_id, ea.envc_cat_id, ea.envc_answer_id
         FROM Envc_Answers ea
         JOIN Envc_Questions eq ON ea.envc_question_id = eq.envc_question_id
         WHERE ea.envc_id = ? AND ea.envc_cat_id = ?`,
            [envcId, envc_cat_id]
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
            `SELECT envc_question_id, question FROM Envc_Questions WHERE envc_cat_id = ?`,
            [envc_cat_id]
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
                envc_question_id: q.envc_question_id,
                envc_id: envcId,
                envc_cat_id: envc_cat_id,
                answer: response.choices[0].message.content,
                userId,
            });
        }

        // 6. Store the answers in the database
        for (let i = 0; i < answers.length; i++) {
            const [result] = await connection.execute(
                `INSERT INTO Envc_Answers (envc_question_id, envc_id, envc_cat_id, answer)
           VALUES (?, ?, ?, ?);`,
                [answers[i].envc_question_id, answers[i].envc_id, answers[i].envc_cat_id, answers[i].answer]
            );
            answers[i].envc_answer_id = result.insertId;
        }

        return res.json({
            message: 'New answers generated and stored successfully',
            category_name: categoryName,
            answers: answers
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});

// AI Task generation
envc.get('/ai/task/generate/:business_idea_id', authenticate, async (req, res) => {

    let connection;

    try {
        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);
        const userId = req.user.user_id;

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Get the business idea details
        const [businessIdeas] = await connection.execute(
            `SELECT * FROM Business_Ideas WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (businessIdeas.length === 0) {
            return res.status(404).json({ message: 'No business idea found for the given business_id' });
        }
        const businessIdea = businessIdeas[0];

        // Get the envc_id for the given business_id
        const [envcs] = await connection.execute(
            `SELECT envc_id FROM Envc WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (envcs.length === 0) {
            return res.status(404).json({ message: 'No envcs found for the given business_id' });
        }
        const envcId = envcs[0].envc_id;

        // Check if tasks already exist for this envc
        const [existingTasks] = await connection.execute(
            `SELECT envc_task_id, task_description, task_status FROM Envc_Tasks WHERE envc_id = ? AND business_idea_id = ?;`,
            [envcId, business_idea_id]
        );

        if (existingTasks.length > 0) {
            // Return existing tasks in structured format
            return res.status(200).json({
                business_idea_id: business_idea_id,
                envc_id: envcId,
                tasks: existingTasks.map(task => ({
                    id: task.envc_task_id,
                    task_description: task.task_description,
                    task_status: task.task_status
                }))
            });
        }

        // Get all questions and answers for the given envc_id  
        const [questionsAndAnswers] = await connection.execute(
            `SELECT eq.envc_question_id, eq.question, ea.answer  
             FROM Envc_Questions eq
             LEFT JOIN Envc_Answers ea ON eq.envc_question_id = ea.envc_question_id  
             WHERE ea.envc_id = ?;`,
            [envcId]
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

        Along with the business idea, some business environmental consideration-related questions and answers are provided:

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
                `INSERT INTO Envc_Tasks (envc_id, business_idea_id, task_description, task_status) 
                 VALUES (?, ?, ?, FALSE)`,
                [envcId, business_idea_id, task]
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
            envc_id: envcId,
            tasks: insertedTasks.map(task => ({
                id: task.id,
                task_description: task.task_description,
                task_status: task.task_status ? 1 : 0 // Convert boolean to int (0 or 1)
            }))
        });

    } catch (error) {
        console.error("Error generating AI task:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});

// user generated task: add task
envc.post("/task/add/:business_idea_id", authenticate, async (req, res) => {

    let connection;

    try {

        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);
        const { task_description } = req.body; // User provides only task_description
        const userId = req.user.user_id;

        // Get a connection from the pool
        connection = await pool.getConnection();

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

        // Fetch the envc_id associated with the given business_idea_id
        const [envcs] = await connection.execute(
            `SELECT envc_id FROM Envc WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (envcs.length === 0) {
            return res.status(404).json({ message: "No envcs found for the given business_idea_id." });
        }
        const envcId = envcs[0].envc_id;

        // Insert the user-generated task into the database
        const [result] = await connection.execute(
            `INSERT INTO Envc_Tasks (envc_id, business_idea_id, task_description, task_status) 
             VALUES (?, ?, ?, FALSE);`,
            [envcId, business_idea_id, task_description]
        );

        // Return the newly added task
        return res.status(201).json({
            message: "Task added successfully.",
            task: {
                id: result.insertId,
                envc_id: envcId,
                business_idea_id: business_idea_id,
                task_description: task_description,
                task_status: 0 // Default status is 0 (incomplete)
            }
        });

    } catch (error) {
        console.error("Error adding user-generated task - Envc:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});

// edit task status 
envc.put('/task/edit/:business_idea_id/:task_id', authenticate, async (req, res) => {

    let connection;

    try {

        let { business_idea_id, task_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);
        task_id = parseInt(task_id, 10);
        const userId = req.user.user_id;

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Check if the task exists
        const [task] = await connection.execute(
            `SELECT * FROM Envc_Tasks WHERE business_idea_id = ? AND envc_task_id = ?;`,
            [business_idea_id, task_id]
        );

        if (task.length === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        // Update task status to 'complete' (1)
        await connection.execute(
            `UPDATE Envc_Tasks SET task_status = 1 WHERE business_idea_id = ? AND envc_task_id = ?;`,
            [business_idea_id, task_id]
        );

        // Get envc_id from the task
        const envc_id = task[0].envc_id;
        // Update Envc Progress
        await updateEnvcProgress(envc_id);

        // Update Business Stage Progress
        await updateBusinessStageProgress(business_idea_id);
        // Update Business Idea Progress
        await updateBusinessIdeaProgress(business_idea_id);

        return res.status(200).json({
            task_id: task_id,
            message: "Task marked as complete successfully"
        });


    } catch (error) {
        console.error("Task Edit Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }

});

// Single API: Edit and Approve ai answer
envc.put('/ai/answer/edit/:envc_answer_id', authenticate, async (req, res) => {

    let connection;

    try {
        let { envc_answer_id } = req.params;
        envc_answer_id = parseInt(envc_answer_id, 10);
        const { answer_content } = req.body; // This could be edited or original content

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Validate input
        if (!answer_content || answer_content.trim() === "") {
            return res.status(400).json({ message: "Answer content is required." });
        }

        // Update the answer and mark as approved
        await connection.execute(
            `UPDATE Envc_Answers 
             SET answer = ?, answer_status = 'approved'
             WHERE envc_answer_id = ?;`,
            [answer_content, envc_answer_id]
        );

        return res.status(200).json({
            envc_answer_id: envc_answer_id,
            message: "Answer approved successfully",
            approved_answer: answer_content
        });

    } catch (error) {
        console.error("Answer Approve Error:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});


envc.get('/envc_categories/:business_idea_id', authenticate, async (req, res) => {

    let connection;

    try {

        // Get a connection from the pool
        connection = await pool.getConnection();

        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);


        const [categories] = await connection.query(
            `SELECT 
                    Envc.envc_id,
                    Envc_Categories.envc_cat_id, 
                    Envc_Categories.category_name
                FROM Envc
                JOIN Envc_Categories_Connect ON Envc.envc_id = Envc_Categories_Connect.envc_id
                JOIN Envc_Categories ON Envc_Categories_Connect.envc_cat_id = Envc_Categories.envc_cat_id
                WHERE Envc.business_idea_id = ?;`, [business_idea_id]);

        const [progress] = await connection.query(
            `select progress from Envc where business_idea_id = ?`, [business_idea_id]
        );
        return res.json({
            "progress": progress[0].progress,
            "categories": categories,
            business_idea_id: business_idea_id
        });


    } catch (error) {
        console.error("Error fetching Envc categories:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});



// ******** Helper function to update progress **********
async function updateEnvcProgress(envc_id) {

    let connection;

    try {

        // Get a connection from the pool
        connection = await pool.getConnection();

        const [[{ total_tasks }]] = await connection.execute(
            `SELECT COUNT(*) AS total_tasks FROM Envc_Tasks WHERE envc_id = ?;`,
            [envc_id]
        );

        const [[{ completed_tasks }]] = await connection.execute(
            `SELECT COUNT(*) AS completed_tasks FROM Envc_Tasks WHERE envc_id = ? AND task_status = 1;`,
            [envc_id]
        );

        const progress = total_tasks > 0 ? (completed_tasks / total_tasks) * 100 : 0;

        await connection.execute(
            `UPDATE Envc SET progress = ? WHERE envc_id = ?;`,
            [progress, envc_id]
        );
    } catch (error) {
        throw error;
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
}


// Function to update Business Stage progress
async function updateBusinessStageProgress(business_idea_id) {

    let connection;

    try {

        // Get a connection from the pool
        connection = await pool.getConnection();

        const [envcs] = await connection.execute(
            `SELECT envc_id FROM Envc WHERE business_idea_id = ?;`,
            [business_idea_id]
        );

        if (envcs.length === 0) return;

        let totalProgress = 0;
        for (const envc of envcs) {
            const [[{ progress }]] = await connection.execute(
                `SELECT progress FROM Envc WHERE envc_id = ?;`,
                [envc.envc_id]
            );
            totalProgress += progress;
        }

        const avgProgress = totalProgress / envcs.length;

        // Update Business_Stages table for stage_id = 6 (Envc Stage)
        await connection.execute(
            `UPDATE Business_Stages SET progress = ? WHERE business_idea_id = ? AND stage_id = 6;`,
            [avgProgress, business_idea_id]
        );
    } catch (error) {
        throw error;
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
}


// Function to update Business Idea progress
async function updateBusinessIdeaProgress(business_idea_id) {

    let connection;

    try {
        // Get a connection from the pool
        connection = await pool.getConnection();

        const [[{ avg_stage_progress }]] = await connection.execute(
            `SELECT AVG(progress) AS avg_stage_progress FROM Business_Stages WHERE business_idea_id = ?;`,
            [business_idea_id]
        );

        await connection.execute(
            `UPDATE Business_Ideas SET idea_progress = ? WHERE business_idea_id = ?;`,
            [avg_stage_progress, business_idea_id]
        );
    } catch (error) {
        throw error;
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
}

export { envc }