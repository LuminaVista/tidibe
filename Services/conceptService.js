async function createConcept(connection, businessIdeaId) {
    try {

        // create the concept table
        const sql = 'INSERT INTO Concept (business_idea_id, progress) VALUES (?, ?)';
        const values = [businessIdeaId, 0];
        const [result] = await connection.execute(sql, values);

        // populate the concept_categories_connect table here 

        // Get the newly created concept_id
        const conceptId = result.insertId;

        // Step 2: Retrieve all categories from Concept_Categories
        const categorySql = 'SELECT concept_cat_id FROM Concept_Categories';
        const [categories] = await connection.execute(categorySql);

        // Step 3: Insert the mappings into Concept_Categories_Conncect
        if (categories.length > 0) {
            const connectSql = `INSERT INTO Concept_Categories_Connect (concept_id, concept_cat_id) VALUES ?`;
            const connectValues = categories.map(category => [conceptId, category.concept_cat_id]);

            await connection.query(connectSql, [connectValues]); // Batch insert
        }

        console.log(`Concept created successfully with ID: ${conceptId}`);
        return conceptId;

    } catch (error) {
        console.error(`Concept creation error for business idea ${businessIdeaId}:`, error);
        throw error; // Re-throw to be handled by the caller
    }
}

export { createConcept }