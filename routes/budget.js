import express from 'express';
import { pool } from '../connectiondb.js';
import authenticate from '../middlewares/authenticate.js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { businessIdea } from './businessIdea.js';


dotenv.config();
const budget = express.Router();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

budget.get('/ai/answer/:business_idea_id/:budget_cat_id', authenticate, async (req, res) => {

    let connection;

    try {
        let { business_idea_id, budget_cat_id } = req.params;
        const userId = req.user.user_id;
        budget_cat_id = parseInt(req.params.budget_cat_id, 10);

        // Get a connection from the pool
        connection = await pool.getConnection();

        // get the category name - budget
        const [category_name] = await connection.execute(
            `SELECT category_name from Budget_Categories where budget_cat_id = ?`,
            [budget_cat_id]
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

        // 2. Get the budget_id for the given business_id
        const [budgets] = await connection.execute(
            `SELECT budget_id FROM Budget WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (budgets.length === 0) {
            return res.status(404).json({ message: 'No budgets found for the given business_id' });
        }
        const budgetId = budgets[0].budget_id;

        // 3. Check if answers already exist in the database
        const [existingAnswers] = await connection.execute(
            `SELECT bq.question, ba.answer, ba.budget_question_id, ba.budget_id, ba.budget_cat_id, ba.budget_answer_id
         FROM Budget_Answers ba
         JOIN Budget_Questions bq ON ba.budget_question_id = bq.budget_question_id
         WHERE ba.budget_id = ? AND ba.budget_cat_id = ?`,
            [budgetId, budget_cat_id]
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
            `SELECT budget_question_id, question FROM Budget_Questions WHERE budget_cat_id = ?`,
            [budget_cat_id]
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
                budget_question_id: q.budget_question_id,
                budget_id: budgetId,
                budget_cat_id: budget_cat_id,
                answer: response.choices[0].message.content,
                userId,
            });
        }

        // 6. Store the answers in the database
        for (let i = 0; i < answers.length; i++) {
            const [result] = await connection.execute(
                `INSERT INTO Budget_Answers (budget_question_id, budget_id, budget_cat_id, answer)
           VALUES (?, ?, ?, ?);`,
                [answers[i].budget_question_id, answers[i].budget_id, answers[i].budget_cat_id, answers[i].answer]
            );
            answers[i].budget_answer_id = result.insertId;
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
budget.get('/ai/task/generate/:business_idea_id', authenticate, async (req, res) => {

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

        // Get the budget_id for the given business_id
        const [budgets] = await connection.execute(
            `SELECT budget_id FROM Budget WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (budgets.length === 0) {
            return res.status(404).json({ message: 'No budgets found for the given business_id' });
        }
        const budgetId = budgets[0].budget_id;

        // Check if tasks already exist for this budget
        const [existingTasks] = await connection.execute(
            `SELECT budget_task_id, task_description, task_status FROM Budget_Tasks WHERE budget_id = ? AND business_idea_id = ?;`,
            [budgetId, business_idea_id]
        );

        if (existingTasks.length > 0) {
            // Return existing tasks in structured format
            return res.status(200).json({
                business_idea_id: business_idea_id,
                budget_id: budgetId,
                tasks: existingTasks.map(task => ({
                    id: task.budget_task_id,
                    task_description: task.task_description,
                    task_status: task.task_status
                }))
            });
        }

        // Get all questions and answers for the given budget_id  
        const [questionsAndAnswers] = await connection.execute(
            `SELECT bq.budget_question_id, bq.question, ba.answer  
             FROM Budget_Questions bq
             LEFT JOIN Budget_Answers ba ON bq.budget_question_id = ba.budget_question_id  
             WHERE ba.budget_id = ?;`,
            [budgetId]
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

        Along with the business idea, some business budget-related questions and answers are provided:

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
                `INSERT INTO Budget_Tasks (budget_id, business_idea_id, task_description, task_status) 
                 VALUES (?, ?, ?, FALSE)`,
                [budgetId, business_idea_id, task]
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
            budget_id: budgetId,
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
budget.post("/task/add/:business_idea_id", authenticate, async (req, res) => {

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

        // Fetch the budget_id associated with the given business_idea_id
        const [budgets] = await connection.execute(
            `SELECT budget_id FROM Budget WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (budgets.length === 0) {
            return res.status(404).json({ message: "No budgets found for the given business_idea_id." });
        }
        const budgetId = budgets[0].budget_id;

        // Insert the user-generated task into the database
        const [result] = await connection.execute(
            `INSERT INTO Budget_Tasks (budget_id, business_idea_id, task_description, task_status) 
             VALUES (?, ?, ?, FALSE);`,
            [budgetId, business_idea_id, task_description]
        );

        // Return the newly added task
        return res.status(201).json({
            message: "Task added successfully.",
            task: {
                id: result.insertId,
                budget_id: budgetId,
                business_idea_id: business_idea_id,
                task_description: task_description,
                task_status: 0 // Default status is 0 (incomplete)
            }
        });

    } catch (error) {
        console.error("Error adding user-generated task - Budget:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});

// edit task status 
budget.put('/task/edit/:business_idea_id/:task_id', authenticate, async (req, res) => {

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
            `SELECT * FROM Budget_Tasks WHERE business_idea_id = ? AND budget_task_id = ?;`,
            [business_idea_id, task_id]
        );

        if (task.length === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        // Update task status to 'complete' (1)
        await connection.execute(
            `UPDATE Budget_Tasks SET task_status = 1 WHERE business_idea_id = ? AND budget_task_id = ?;`,
            [business_idea_id, task_id]
        );

        // Get budget_id from the task
        const budget_id = task[0].budget_id;
        // Update Budget Progress
        await updateBudgetProgress(budget_id);

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
budget.put('/ai/answer/edit/:budget_answer_id', authenticate, async (req, res) => {

    let connection;

    try {
        let { budget_answer_id } = req.params;
        budget_answer_id = parseInt(budget_answer_id, 10);
        const { answer_content } = req.body; // This could be edited or original content

        // Get a connection from the pool
        connection = await pool.getConnection();

        // Validate input
        if (!answer_content || answer_content.trim() === "") {
            return res.status(400).json({ message: "Answer content is required." });
        }

        // Update the answer and mark as approved
        await connection.execute(
            `UPDATE Budget_Answers 
             SET answer = ?, answer_status = 'approved'
             WHERE budget_answer_id = ?;`,
            [answer_content, budget_answer_id]
        );

        return res.status(200).json({
            budget_answer_id: budget_answer_id,
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


budget.get('/budget_categories/:business_idea_id', authenticate, async (req, res) => {

    let connection;

    try {

        // Get a connection from the pool
        connection = await pool.getConnection();

        let { business_idea_id } = req.params;
        business_idea_id = parseInt(business_idea_id, 10);


        const [categories] = await connection.query(
            `SELECT 
                    Budget.budget_id,
                    Budget_Categories.budget_cat_id, 
                    Budget_Categories.category_name
                FROM Budget
                JOIN Budget_Categories_Connect ON Budget.budget_id = Budget_Categories_Connect.budget_id
                JOIN Budget_Categories ON Budget_Categories_Connect.budget_cat_id = Budget_Categories.budget_cat_id
                WHERE Budget.business_idea_id = ?;`, [business_idea_id]);

        const [progress] = await connection.query(
            `select progress from Budget where business_idea_id = ?`, [business_idea_id]
        );
        return res.json({
            "progress": progress[0].progress,
            "categories": categories,
            business_idea_id: business_idea_id
        });


    } catch (error) {
        console.error("Error fetching Budget categories:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});


// ******** Helper function to update progress **********
async function updateBudgetProgress(budget_id) {

    let connection;

    try {

        // Get a connection from the pool
        connection = await pool.getConnection();

        const [[{ total_tasks }]] = await connection.execute(
            `SELECT COUNT(*) AS total_tasks FROM Budget_Tasks WHERE budget_id = ?;`,
            [budget_id]
        );

        const [[{ completed_tasks }]] = await connection.execute(
            `SELECT COUNT(*) AS completed_tasks FROM Budget_Tasks WHERE budget_id = ? AND task_status = 1;`,
            [budget_id]
        );

        const progress = total_tasks > 0 ? (completed_tasks / total_tasks) * 100 : 0;

        await connection.execute(
            `UPDATE Budget SET progress = ? WHERE budget_id = ?;`,
            [progress, budget_id]
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

        const [budgets] = await connection.execute(
            `SELECT budget_id FROM Budget WHERE business_idea_id = ?;`,
            [business_idea_id]
        );

        if (budgets.length === 0) return;

        let totalProgress = 0;
        for (const budget of budgets) {
            const [[{ progress }]] = await connection.execute(
                `SELECT progress FROM Budget WHERE budget_id = ?;`,
                [budget.budget_id]
            );
            totalProgress += progress;
        }

        const avgProgress = totalProgress / budgets.length;

        // Update Business_Stages table for stage_id = 2 (Budget Stage)
        await connection.execute(
            `UPDATE Business_Stages SET progress = ? WHERE business_idea_id = ? AND stage_id = 5;`,
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


export { budget }

