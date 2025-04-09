import express from 'express';
import { users } from './routes/users.js';
import { businessIdea } from './routes/businessIdea.js';
import { concept } from './routes/concept.js';
import { research } from './routes/research.js';
import { marketing } from './routes/marketing.js';
import { budget } from './routes/budget.js';
import { envc } from './routes/envc.js';

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
app.use('/api/marketing', marketing);
app.use('/api/budget', budget);
app.use('/api/envc', envc);

app.listen(3000, '0.0.0.0', () => {
    console.log("Server running on port 3000");
});


