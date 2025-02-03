import express from 'express'

const users = express.Router();

users.get('/test', async(req, res)=>{
    res.json({msg: "get api working"});
});

export { users }


