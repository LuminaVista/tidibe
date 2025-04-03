import express from 'express';
import { users } from './routes/users.js';
import { businessIdea } from './routes/businessIdea.js';
import { concept } from './routes/concept.js';
import { research } from './routes/research.js';
import { resetpassword } from './routes/resetpassword.js'
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// base - endpoints 
app.use('/api/users', users);
app.use('/api/businessIdea', businessIdea);
app.use('/api/concept',concept);
app.use('/api/rp', resetpassword);
app.use('/api/research', research);

app.listen(3000, '0.0.0.0', () => {
    console.log("Server running on port 3000");
});


