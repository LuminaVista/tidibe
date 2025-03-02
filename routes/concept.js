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

        return res.json({
            "categories": categories,
            business_idea_id: business_idea_id
        });


    } catch (error) {
        console.error("Error fetching concept categories:", error);
        return res.status(500).json({ error: "Internal Server Error" });
    }




});



export { concept }
