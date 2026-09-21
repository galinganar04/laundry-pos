const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS services (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                price NUMERIC NOT NULL,
                unit TEXT NOT NULL,
                status TEXT DEFAULT 'Available'
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                date TEXT NOT NULL,
                customer TEXT NOT NULL,
                total NUMERIC NOT NULL,
                payment_status TEXT NOT NULL
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(id),
                service_name TEXT,
                quantity INTEGER,
                price NUMERIC
            );
        `);

        const result = await pool.query('SELECT COUNT(*) FROM services');
        if (parseInt(result.rows[0].count) === 0) {
            await pool.query(`INSERT INTO services (name, price, unit) VALUES
                ('Wash Dry & Fold', 240.00, 'kg'),
                ('Wash & Dry', 180.00, 'kg'),
                ('Dry Only', 50.00, 'kg')
            `);
            console.log('Sample services added.');
        }

        console.log('Database initialized.');
    } catch (err) {
        console.error('Database init error:', err.message);
    }
}

initDatabase();

async function getServices() {
    const result = await pool.query("SELECT * FROM services WHERE status = 'Available'");
    return result.rows;
}

async function addService(name, price, unit) {
    const result = await pool.query(
        "INSERT INTO services (name, price, unit, status) VALUES ($1, $2, $3, 'Available') RETURNING id",
        [name, price, unit]
    );
    return result.rows[0].id;
}

async function deleteService(id) {
    await pool.query("DELETE FROM services WHERE id = $1", [id]);
}

async function saveOrder(customer, total, cartItems) {
    const date = new Date().toISOString();
    const orderResult = await pool.query(
        "INSERT INTO orders (date, customer, total, payment_status) VALUES ($1, $2, $3, 'Pending') RETURNING id",
        [date, customer, total]
    );
    const orderId = orderResult.rows[0].id;

    for (const item of cartItems) {
        await pool.query(
            "INSERT INTO order_items (order_id, service_name, quantity, price) VALUES ($1, $2, $3, $4)",
            [orderId, item.name, item.qty, item.price]
        );
    }

    return orderId;
}

module.exports = {
    pool,
    getServices,
    addService,
    deleteService,
    saveOrder
};