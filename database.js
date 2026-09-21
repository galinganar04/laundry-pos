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

        await pool.query(`
            CREATE TABLE IF NOT EXISTS customers (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                phone TEXT,
                address TEXT,
                notes TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `);

        // Add 'status' column to orders table if it doesn't exist
        await pool.query(`
            ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Received';
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

async function saveOrder(customer, total, cartItems, paymentStatus) {
    const date = new Date().toISOString();
    const status = paymentStatus || 'Pending';
    const orderResult = await pool.query(
        "INSERT INTO orders (date, customer, total, payment_status) VALUES ($1, $2, $3, $4) RETURNING id",
        [date, customer, total, status]
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

async function getOrders(filter) {
    let query = "SELECT id, date, customer, total, payment_status, COALESCE(status, 'Received') AS status FROM orders";
    if (filter === 'paid') {
        query += " WHERE payment_status = 'Paid'";
    } else if (filter === 'unpaid') {
        query += " WHERE payment_status = 'Pending'";
    } else if (filter === 'received') {
        query += " WHERE status = 'Received'";
    } else if (filter === 'washing') {
        query += " WHERE status = 'Washing'";
    } else if (filter === 'ready') {
        query += " WHERE status = 'Ready'";
    } else if (filter === 'pickedup') {
        query += " WHERE status = 'Picked Up'";
    }
    query += " ORDER BY id DESC LIMIT 200";
    const result = await pool.query(query);
    return result.rows;
}

async function markAsPaid(id) {
    await pool.query("UPDATE orders SET payment_status = 'Paid' WHERE id = $1", [id]);
}

async function markAsUnpaid(id) {
    await pool.query("UPDATE orders SET payment_status = 'Pending' WHERE id = $1", [id]);
}

async function deleteOrder(id) {
    await pool.query("DELETE FROM order_items WHERE order_id = $1", [id]);
    await pool.query("DELETE FROM orders WHERE id = $1", [id]);
}

async function updateOrderStatus(id, status) {
    await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id]);
}

async function getCustomers(search) {
    let query = "SELECT * FROM customers";
    const params = [];
    if (search) {
        query += " WHERE name ILIKE $1 OR phone ILIKE $1";
        params.push('%' + search + '%');
    }
    query += " ORDER BY name ASC LIMIT 200";
    const result = await pool.query(query, params);
    return result.rows;
}

async function getCustomer(id) {
    const result = await pool.query("SELECT * FROM customers WHERE id = $1", [id]);
    return result.rows[0];
}

async function addCustomer(name, phone, address, notes) {
    const result = await pool.query(
        "INSERT INTO customers (name, phone, address, notes) VALUES ($1, $2, $3, $4) RETURNING id",
        [name, phone || null, address || null, notes || null]
    );
    return result.rows[0].id;
}

async function updateCustomer(id, name, phone, address, notes) {
    await pool.query(
        "UPDATE customers SET name = $1, phone = $2, address = $3, notes = $4 WHERE id = $5",
        [name, phone || null, address || null, notes || null, id]
    );
}

async function deleteCustomer(id) {
    await pool.query("DELETE FROM customers WHERE id = $1", [id]);
}

async function getCustomerOrders(name) {
    const result = await pool.query(
        "SELECT id, date, customer, total, payment_status FROM orders WHERE customer = $1 ORDER BY id DESC LIMIT 50",
        [name]
    );
    return result.rows;
}

module.exports = {
    pool,
    getServices,
    addService,
    deleteService,
    saveOrder,
    getOrders,
    markAsPaid,
    markAsUnpaid,
    deleteOrder,
    updateOrderStatus,
    getCustomers,
    getCustomer,
    addCustomer,
    updateCustomer,
    deleteCustomer,
    getCustomerOrders
};