import express from 'express';
import { pool } from '../connectiondb.js';
import authenticate from '../middlewares/authenticate.js';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { businessIdea } from './businessIdea.js';


dotenv.config();
const concept = express.Router();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

