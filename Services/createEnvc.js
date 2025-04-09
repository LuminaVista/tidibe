async function createEnvc(connection, businessIdeaId) {
    try {

        // create the Envc table
        const sql = 'INSERT INTO Envc (business_idea_id, progress) VALUES (?, ?)';
        const values = [businessIdeaId, 0];
        const [result] = await connection.execute(sql, values);

        // Get the newly created envc_id
        const envcId = result.insertId;

        // Step 2: Retrieve all categories from Envc_Categories
        const categorySql = 'SELECT envc_cat_id FROM Envc_Categories';
        const [categories] = await connection.execute(categorySql);

        // Step 3: Insert the mappings into Envc_Categories_Connect
        if (categories.length > 0) {
            const connectSql = `INSERT INTO Envc_Categories_Connect (envc_id, envc_cat_id) VALUES ?`;
            const connectValues = categories.map(category => [envcId, category.envc_cat_id]);

            await connection.query(connectSql, [connectValues]); // Batch insert
        }

        console.log(`Envc created successfully with ID: ${envcId}`);
        return envcId;

    } catch (error) {
        console.error(`Envc creation error for business idea ${businessIdeaId}:`, error);
        throw error; // Re-throw to be handled by the caller
    }
}

export { createEnvc }