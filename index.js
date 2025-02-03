import express from 'express';
import { users } from './routes/users.js';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// base - endpoints 
app.use('/api/users', users);

app.listen(3000,()=>{
    console.log("Server is running on port 3000");
})


