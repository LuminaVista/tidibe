async function createBudget(connection, businessIdeaId) {
    try {

        // create the Budget table
        const sql = 'INSERT INTO Budget (business_idea_id, progress) VALUES (?, ?)';
        const values = [businessIdeaId, 0];
        const [result] = await connection.execute(sql, values);

        // Get the newly created budget_id
        const budgetId = result.insertId;

        // Step 2: Retrieve all categories from Budget_Categories
        const categorySql = 'SELECT budget_cat_id FROM Budget_Categories';
        const [categories] = await connection.execute(categorySql);

        // Step 3: Insert the mappings into Budget_Categories_Connect
        if (categories.length > 0) {
            const connectSql = `INSERT INTO Budget_Categories_Connect (budget_id, budget_cat_id) VALUES ?`;
            const connectValues = categories.map(category => [budgetId, category.budget_cat_id]);

            await connection.query(connectSql, [connectValues]); // Batch insert
        }

        console.log(`Budget created successfully with ID: ${budgetId}`);
        return budgetId;

    } catch (error) {
        console.error(`Budget creation error for business idea ${businessIdeaId}:`, error);
        throw error; // Re-throw to be handled by the caller
    }
}

export { createBudget }