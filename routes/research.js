import express from 'express';
import { pool } from '../connectiondb.js';
import authenticate from '../middlewares/authenticate.js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { businessIdea } from './businessIdea.js';


dotenv.config();
const research = express.Router();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

research.get('/ai/answer/:business_idea_id/:research_cat_id', authenticate, async (req, res) => {

    let connection;

    try {
        let { business_idea_id, research_cat_id } = req.params;
        const userId = req.user.user_id;
        research_cat_id = parseInt(req.params.research_cat_id, 10);

        // Get a connection from the pool
        connection = await pool.getConnection();

        // get the category name - research
        const [category_name] = await connection.execute(
            `SELECT category_name from Research_Categories where research_cat_id = ?`,
            [research_cat_id]
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

        // 2. Get the research_id for the given business_id
        const [researches] = await connection.execute(
            `SELECT research_id FROM Research WHERE business_idea_id = ?;`,
            [business_idea_id]
        );
        if (researches.length === 0) {
            return res.status(404).json({ message: 'No Research found for the given business_id' });
        }
        const researchId = researches[0].research_id;

        // 3. Check if answers already exist in the database
        const [existingAnswers] = await connection.execute(
            `SELECT rq.question, ra.answer, ra.research_question_id, ra.research_id, ra.research_cat_id
         FROM Research_Answers ra
         JOIN Research_Questions rq ON ra.research_question_id = rq.research_question_id
         WHERE ra.research_id = ? AND ra.research_cat_id = ?`,
            [researchId, research_cat_id]
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
            `SELECT research_question_id, question FROM Research_Questions WHERE research_cat_id = ?`,
            [research_cat_id]
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
                research_question_id: q.research_question_id,
                research_id: researchId,
                research_cat_id: research_cat_id,
                answer: response.choices[0].message.content,
                userId,
            });
        }

        // 6. Store the answers in the database
        for (let answer of answers) {
            await connection.execute(
                `INSERT INTO Research_Answers (research_question_id, research_id, research_cat_id, answer)
           VALUES (?, ?, ?, ?);`,
                [answer.research_question_id, answer.research_id, answer.research_cat_id, answer.answer]
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
    } finally {
        // Always release the connection back to the pool
        if (connection) {
            connection.release();
        }
    }
});


export { research }