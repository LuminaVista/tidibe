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


concept.post('/ai/answer/:business_idea_id', authenticate, async (req, res) => {
    try {
        const { business_idea_id } = req.params;
        const userId = req.user.user_id; // Extract user_id from authentication token

        // 0. Get the business idea details
        const [businessIdeas] = await connection.execute(
            `SELECT * FROM Business_Ideas WHERE business_idea_id = ?;`, 
            [business_idea_id]
        );

        if (businessIdeas.length === 0) {
            return res.status(404).json({ message: 'No business idea found for the given business_id' });
        }

        const businessIdea = businessIdeas[0];

        // 1. Get the concept_id for the given business_id
        const [concepts] = await connection.execute(
            `SELECT concept_id FROM Concept WHERE business_idea_id = ?;`,
            [business_idea_id]
        );

        if (concepts.length === 0) {
            return res.status(404).json({ message: 'No concept found for the given business_id' });
        }

        const conceptId = concepts[0].concept_id;

        // 2. Get all concept_cat_id for this concept
        const [categories] = await connection.execute(
            `SELECT DISTINCT concept_cat_id FROM Concept_Categories;`
        );

        if (categories.length === 0) {
            return res.status(404).json({ message: 'No categories found for the concept' });
        }

        const conceptCatIds = categories.map(row => row.concept_cat_id);

        // 3. Get all questions for the retrieved categories
        const [questions] = await connection.execute(
            `SELECT concept_question_id, question FROM Concept_Questions WHERE concept_cat_id IN (${conceptCatIds.map(() => '?').join(',')});`,
            conceptCatIds
        );

        if (questions.length === 0) {
            return res.status(404).json({ message: 'No questions found' });
        }

        // 4. Call OpenAI API for each question
        

        let answers = [];
        for (let q of questions) {

            const ai_prompt = `
            
                You are a Senior Business Consultant. Clients come to you with their idea and you review them and give them specific feedback. 

                analyse the ${businessIdea["idea_foundation"]} along with ${businessIdea["problem_statement"]}, ${businessIdea["unique_solution"]}.
                Consider the  ${businessIdea["target_location"]}, and provide the answer of the following question:

                ${q.question}
                

                Return the result in text format. Keep the answerd medium and firm and related. maybe for each question four bullet points are fine, not more than that. 

            `;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [{ role: "user", content: ai_prompt }]
            });
            
            

            // answers.push({
            //     concept_question_id: q.concept_question_id,
            //     concept_id: conceptId,
            //     concept_cat_id: conceptCatIds[0], // Assuming one category per question
            //     answer: response.choices[0].message.content,
            //     userId, // Store user_id for tracking
            // });
            
            answers.push({
                question: q.question,
                answer: response.choices[0].message.content
            })

        }

        console.log(answers);

        // 5. Store the answers in the database
        // for (let answer of answers) {
        //     await connection.execute(
        //         `INSERT INTO Concept_Answers (concept_question_id, concept_id, concept_cat_id, answer) 
        //          VALUES (?, ?, ?, ?, ?);`,
        //         [answer.concept_question_id, answer.concept_id, answer.concept_cat_id, answer.answer]
        //     );
        // }

        return res.json({ message: 'Answers stored successfully' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


concept.get('/concept_categories/:business_idea_id', authenticate, async(req, res)=>{

    try{
        let {business_idea_id} = req.params;
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

        return res.json({
            "categories": categories,
            business_idea_id: business_idea_id
        });


    }catch(error){
        console.error("Error fetching concept categories:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }




});



export { concept }
