async function createResearch(connection, businessIdeaId) {
    try {

        // create the Research table
        const sql = 'INSERT INTO Research (business_idea_id, progress) VALUES (?, ?)';
        const values = [businessIdeaId, 0];
        const [result] = await connection.execute(sql, values);

        // Get the newly created research_id
        const researchtId = result.insertId;

        // Step 2: Retrieve all categories from Research_Categories
        const categorySql = 'SELECT research_cat_id FROM Research_Categories';
        const [categories] = await connection.execute(categorySql);

        // Step 3: Insert the mappings into Research_Categories_Connect
        if (categories.length > 0) {
            const connectSql = `INSERT INTO Research_Categories_Connect (research_id, research_cat_id) VALUES ?`;
            const connectValues = categories.map(category => [researchtId, category.research_cat_id]);

            await connection.query(connectSql, [connectValues]); // Batch insert
        }

        console.log(`Research created successfully with ID: ${researchtId}`);
        return conceptId;

    } catch (error) {
        console.error(`Research creation error for business idea ${businessIdeaId}:`, error);
        throw error; // Re-throw to be handled by the caller
    }
}

export { createResearch }