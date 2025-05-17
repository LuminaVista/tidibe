async function createBrand(connection, businessIdeaId) {
    try {

        // create the Brand table
        const sql = 'INSERT INTO Brand (business_idea_id, progress) VALUES (?, ?)';
        const values = [businessIdeaId, 0];
        const [result] = await connection.execute(sql, values);

        // Get the newly created brand_id
        const brandId = result.insertId;

        // Step 2: Retrieve all categories from Brand_Categories
        const categorySql = 'SELECT brand_cat_id FROM Brand_Categories';
        const [categories] = await connection.execute(categorySql);

        // Step 3: Insert the mappings into Brand_Categories_Connect
        if (categories.length > 0) {
            const connectSql = `INSERT INTO Brand_Categories_Connect (brand_id, brand_cat_id) VALUES ?`;
            const connectValues = categories.map(category => [brandId, category.brand_cat_id]);

            await connection.query(connectSql, [connectValues]); // Batch insert
        }

        console.log(`Brand created successfully with ID: ${brandId}`);
        return brandId;

    } catch (error) {
        console.error(`Brand creation error for business idea ${businessIdeaId}:`, error);
        throw error; // Re-throw to be handled by the caller
    }
}

export { createBrand }