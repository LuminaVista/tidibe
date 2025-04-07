async function createMarketing(connection, businessIdeaId) {
    try {

        // create the Marketing table
        const sql = 'INSERT INTO Marketing (business_idea_id, progress) VALUES (?, ?)';
        const values = [businessIdeaId, 0];
        const [result] = await connection.execute(sql, values);

        // Get the newly created marketing_id
        const marketingId = result.insertId;

        // Step 2: Retrieve all categories from Marketing_Categories
        const categorySql = 'SELECT marketing_cat_id FROM Marketing_Categories';
        const [categories] = await connection.execute(categorySql);

        // Step 3: Insert the mappings into Marketing_Categories_Connect
        if (categories.length > 0) {
            const connectSql = `INSERT INTO Marketing_Categories_Connect (marketing_id, marketing_cat_id) VALUES ?`;
            const connectValues = categories.map(category => [marketingId, category.marketing_cat_id]);

            await connection.query(connectSql, [connectValues]); // Batch insert
        }

        console.log(`Marketing Data created successfully with ID: ${marketingId}`);
        return marketingId;

    } catch (error) {
        console.error(`Marketing Data creation error for business idea ${businessIdeaId}:`, error);
        throw error; // Re-throw to be handled by the caller
    }
}

export { createMarketing }