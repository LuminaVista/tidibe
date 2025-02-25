async function createConcept(connection, businessIdeaId) {
    try{

        // create the concept table
        const sql = 'INSERT INTO Concept (business_idea_id, progress) VALUES (?, ?)';
        const values = [businessIdeaId, 0];
        const [result] = await connection.execute(sql, values);

    }catch (error) {
        console.error(`Concept creation error for business idea ${businessIdeaId}:`, error);
        throw error; // Re-throw to be handled by the caller
    }
}



export { createConcept }