const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDatabase() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS services (id SERIAL PRIMARY KEY, name TEXT NOT NULL, price NUMERIC NOT NULL, unit TEXT NOT NULL, status TEXT DEFAULT 'Available');`);
        await pool.query(`CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, date TEXT NOT NULL, customer TEXT NOT NULL, total NUMERIC NOT NULL, payment_status TEXT NOT NULL);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS order_items (id SERIAL PRIMARY KEY, order_id INTEGER REFERENCES orders(id), service_name TEXT, quantity INTEGER, price NUMERIC);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS customers (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, phone TEXT, address TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW());`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Received';`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS cashier_name TEXT;`);
        await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS cashiers (id SERIAL PRIMARY KEY, name TEXT NOT NULL, pin TEXT NOT NULL, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT DEFAULT 'General', cost_price NUMERIC DEFAULT 0, selling_price NUMERIC DEFAULT 0, stock INTEGER DEFAULT 0, low_limit INTEGER DEFAULT 5, icon TEXT DEFAULT '📦', created_at TIMESTAMPTZ DEFAULT NOW());`);
        await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS image_data TEXT;`);
        await pool.query(`CREATE TABLE IF NOT EXISTS replenishments (id SERIAL PRIMARY KEY, product_id INTEGER REFERENCES products(id), quantity INTEGER NOT NULL, cost NUMERIC DEFAULT 0, date TIMESTAMPTZ DEFAULT NOW(), notes TEXT);`);
        await pool.query(`ALTER TABLE replenishments ADD COLUMN IF NOT EXISTS supplier TEXT;`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#4f46e5';`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS service_type TEXT DEFAULT 'Per Load';`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS minimum NUMERIC DEFAULT 1;`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS unit_label TEXT DEFAULT 'kg';`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS image_data TEXT;`);
        await pool.query(`CREATE TABLE IF NOT EXISTS service_materials (id SERIAL PRIMARY KEY, service_id INTEGER REFERENCES services(id) ON DELETE CASCADE, product_id INTEGER REFERENCES products(id), quantity INTEGER DEFAULT 1, amount NUMERIC DEFAULT 0);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS expenses (id SERIAL PRIMARY KEY, date TIMESTAMPTZ DEFAULT NOW(), category TEXT NOT NULL, description TEXT, amount NUMERIC NOT NULL, supplier TEXT, notes TEXT, si_or_number TEXT, account TEXT DEFAULT 'Operating Expense');`);
        await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS si_or_number TEXT;`);
        await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account TEXT DEFAULT 'Operating Expense';`);

        // Archived orders
        await pool.query(`CREATE TABLE IF NOT EXISTS archived_orders (id SERIAL PRIMARY KEY, original_id INTEGER, date TEXT NOT NULL, customer TEXT NOT NULL, total NUMERIC NOT NULL, payment_status TEXT NOT NULL, status TEXT, cashier_name TEXT, archived_at TIMESTAMPTZ DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS archived_order_items (id SERIAL PRIMARY KEY, archived_order_id INTEGER REFERENCES archived_orders(id), service_name TEXT, quantity INTEGER, price NUMERIC);`);

        // Users table for login system
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT,
            full_name TEXT,
            role TEXT DEFAULT 'admin',
            security_question TEXT,
            security_answer_hash TEXT,
            reset_token TEXT,
            reset_token_expires TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_login TIMESTAMPTZ
        );`);

        const defaults = [
            ['shop_name', "Hawi's Lovada"], ['tagline', 'Clean. Fresh. Wash with Love.'],
            ['tin', ''], ['address', ''], ['phone', ''], ['email', ''], ['facebook', ''],
            ['currency', '₱'], ['tax_type', 'Non-VAT']
        ];
        for (const [key, value] of defaults) {
            await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [key, value]);
        }

        const result = await pool.query('SELECT COUNT(*) FROM services');
        if (parseInt(result.rows[0].count) === 0) {
            await pool.query(`INSERT INTO services (name, price, unit) VALUES ('Wash Dry & Fold', 240.00, 'kg'), ('Wash & Dry', 180.00, 'kg'), ('Dry Only', 50.00, 'kg')`);
        }

        console.log('Database initialized.');
    } catch (err) {
        console.error('Database init error:', err.message);
    }
}

initDatabase();

async function getServices() {
    const result = await pool.query("SELECT * FROM services WHERE status = 'Available' ORDER BY id ASC");
    const services = result.rows;
    for (const s of services) {
        const mats = await pool.query(`SELECT sm.id, sm.product_id, sm.quantity, sm.amount, p.name AS product_name FROM service_materials sm LEFT JOIN products p ON p.id = sm.product_id WHERE sm.service_id = $1`, [s.id]);
        s.materials = mats.rows;
    }
    return services;
}

async function addService(data) {
    const result = await pool.query(
        `INSERT INTO services (name, price, unit, status, color, service_type, minimum, unit_label, image_data)
         VALUES ($1, $2, $3, 'Available', $4, $5, $6, $7, $8) RETURNING id`,
        [data.name, parseFloat(data.price) || 0, data.unit_label || 'kg', data.color || '#4f46e5',
         data.service_type || 'Per Load', parseFloat(data.minimum) || 1, data.unit_label || 'kg',
         data.image_data || null]);
    const serviceId = result.rows[0].id;
    if (Array.isArray(data.materials)) {
        for (const m of data.materials) {
            if (m.product_id && m.quantity > 0) {
                await pool.query(`INSERT INTO service_materials (service_id, product_id, quantity, amount) VALUES ($1, $2, $3, $4)`,
                    [serviceId, m.product_id, parseInt(m.quantity) || 1, parseFloat(m.amount) || 0]);
            }
        }
    }
    return serviceId;
}

async function updateService(id, data) {
    await pool.query(
        `UPDATE services SET name = $1, price = $2, unit = $3, color = $4, service_type = $5, 
         minimum = $6, unit_label = $7, image_data = $8 WHERE id = $9`,
        [data.name, parseFloat(data.price) || 0, data.unit_label || 'kg', data.color || '#4f46e5',
         data.service_type || 'Per Load', parseFloat(data.minimum) || 1, data.unit_label || 'kg',
         data.image_data || null, id]);
    await pool.query("DELETE FROM service_materials WHERE service_id = $1", [id]);
    if (Array.isArray(data.materials)) {
        for (const m of data.materials) {
            if (m.product_id && m.quantity > 0) {
                await pool.query(`INSERT INTO service_materials (service_id, product_id, quantity, amount) VALUES ($1, $2, $3, $4)`,
                    [id, m.product_id, parseInt(m.quantity) || 1, parseFloat(m.amount) || 0]);
            }
        }
    }
}

async function deleteService(id) {
    await pool.query("DELETE FROM service_materials WHERE service_id = $1", [id]);
    await pool.query("DELETE FROM services WHERE id = $1", [id]);
}

async function saveOrder(customer, total, cartItems, paymentStatus, cashierName) {
    const date = new Date().toISOString();
    const status = paymentStatus || 'Pending';
    const orderResult = await pool.query("INSERT INTO orders (date, customer, total, payment_status, cashier_name) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [date, customer, total, status, cashierName || 'Admin']);
    const orderId = orderResult.rows[0].id;
    for (const item of cartItems) {
        await pool.query("INSERT INTO order_items (order_id, service_name, quantity, price) VALUES ($1, $2, $3, $4)",
            [orderId, item.name, item.qty, item.price]);
        if (item.type === 'addon') {
            await pool.query("UPDATE products SET stock = GREATEST(stock - $1, 0) WHERE name = $2", [item.qty, item.name]);
        }
        if (item.type === 'service') {
            const svc = await pool.query("SELECT id FROM services WHERE name = $1", [item.name]);
            if (svc.rows.length > 0) {
                const mats = await pool.query("SELECT product_id, quantity FROM service_materials WHERE service_id = $1", [svc.rows[0].id]);
                for (const m of mats.rows) {
                    await pool.query("UPDATE products SET stock = GREATEST(stock - ($1 * $2), 0) WHERE id = $3",
                        [m.quantity, item.qty, m.product_id]);
                }
            }
        }
    }
    return orderId;
}

async function getOrders(filter, search, dateFrom, dateTo) {
    const conditions = [];
    const params = [];
    if (filter === 'paid') conditions.push("payment_status = 'Paid'");
    else if (filter === 'unpaid') conditions.push("payment_status = 'Pending'");
    else if (filter === 'received') conditions.push("status = 'Received'");
    else if (filter === 'washing') conditions.push("status = 'Washing'");
    else if (filter === 'drying') conditions.push("status = 'Drying'");
    else if (filter === 'ready') conditions.push("status = 'Ready'");
    else if (filter === 'pickedup') conditions.push("status = 'Picked Up'");
    if (search) {
        params.push('%' + search + '%');
        params.push(search);
        conditions.push(`(customer ILIKE $${params.length - 1} OR CAST(id AS TEXT) = $${params.length})`);
    }
    if (dateFrom) { params.push(dateFrom); conditions.push(`date::timestamptz >= $${params.length}::timestamptz`); }
    if (dateTo) { params.push(dateTo + ' 23:59:59'); conditions.push(`date::timestamptz <= $${params.length}::timestamptz`); }
    let query = "SELECT id, date, customer, total, payment_status, COALESCE(status, 'Received') AS status, cashier_name FROM orders";
    if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY id DESC LIMIT 500";
    const result = await pool.query(query, params);
    return result.rows;
}

async function markAsPaid(id) { await pool.query("UPDATE orders SET payment_status = 'Paid' WHERE id = $1", [id]); }
async function markAsUnpaid(id) { await pool.query("UPDATE orders SET payment_status = 'Pending' WHERE id = $1", [id]); }

async function deleteOrder(id) {
    const orderResult = await pool.query(
        "SELECT id, date, customer, total, payment_status, COALESCE(status, 'Received') AS status, cashier_name FROM orders WHERE id = $1",
        [id]
    );
    if (orderResult.rows.length === 0) return;
    const order = orderResult.rows[0];
    const archivedResult = await pool.query(
        `INSERT INTO archived_orders (original_id, date, customer, total, payment_status, status, cashier_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [order.id, order.date, order.customer, order.total, order.payment_status, order.status, order.cashier_name]
    );
    const archivedId = archivedResult.rows[0].id;
    const items = await pool.query("SELECT service_name, quantity, price FROM order_items WHERE order_id = $1", [id]);
    for (const item of items.rows) {
        await pool.query(
            "INSERT INTO archived_order_items (archived_order_id, service_name, quantity, price) VALUES ($1, $2, $3, $4)",
            [archivedId, item.service_name, item.quantity, item.price]
        );
    }
    await pool.query("DELETE FROM order_items WHERE order_id = $1", [id]);
    await pool.query("DELETE FROM orders WHERE id = $1", [id]);
}

async function updateOrderStatus(id, status) { await pool.query("UPDATE orders SET status = $1 WHERE id = $2", [status, id]); }

async function getCustomers(search) {
    let query = "SELECT * FROM customers";
    const params = [];
    if (search) { query += " WHERE name ILIKE $1 OR phone ILIKE $1"; params.push('%' + search + '%'); }
    query += " ORDER BY name ASC LIMIT 200";
    const result = await pool.query(query, params);
    return result.rows;
}
async function getCustomer(id) { const result = await pool.query("SELECT * FROM customers WHERE id = $1", [id]); return result.rows[0]; }
async function addCustomer(name, phone, address, notes) {
    const result = await pool.query("INSERT INTO customers (name, phone, address, notes) VALUES ($1, $2, $3, $4) RETURNING id",
        [name, phone || null, address || null, notes || null]);
    return result.rows[0].id;
}
async function updateCustomer(id, name, phone, address, notes) {
    await pool.query("UPDATE customers SET name = $1, phone = $2, address = $3, notes = $4 WHERE id = $5",
        [name, phone || null, address || null, notes || null, id]);
}
async function deleteCustomer(id) { await pool.query("DELETE FROM customers WHERE id = $1", [id]); }
async function getCustomerOrders(name) {
    const result = await pool.query("SELECT id, date, customer, total, payment_status FROM orders WHERE customer = $1 ORDER BY id DESC LIMIT 50", [name]);
    return result.rows;
}

async function getReportSummary(dateFrom, dateTo) {
    const result = await pool.query(`
        SELECT COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS total_revenue,
            COALESCE(AVG(total), 0) AS avg_order_value,
            COALESCE(SUM(CASE WHEN payment_status = 'Pending' THEN total ELSE 0 END), 0) AS unpaid_revenue
        FROM (
            SELECT total, payment_status FROM orders 
            WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz
            UNION ALL
            SELECT total, payment_status FROM archived_orders 
            WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz
        ) combined`,
        [dateFrom, dateTo + ' 23:59:59']);
    return result.rows[0];
}

async function getReportDaily(dateFrom, dateTo) {
    const result = await pool.query(`
        SELECT DATE(date::timestamptz) AS day, COUNT(*) AS order_count,
            COALESCE(SUM(total), 0) AS revenue, COALESCE(AVG(total), 0) AS avg_order
        FROM (
            SELECT date, total FROM orders 
            WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz
            UNION ALL
            SELECT date, total FROM archived_orders 
            WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz
        ) combined
        GROUP BY DATE(date::timestamptz) ORDER BY day ASC`, [dateFrom, dateTo + ' 23:59:59']);
    return result.rows;
}

async function getReportTopServices(dateFrom, dateTo) {
    const result = await pool.query(`
        SELECT service_name, SUM(quantity) AS total_qty, SUM(quantity * price) AS total_revenue
        FROM (
            SELECT oi.service_name, oi.quantity, oi.price FROM order_items oi 
            JOIN orders o ON o.id = oi.order_id
            WHERE o.date::timestamptz >= $1::timestamptz AND o.date::timestamptz <= $2::timestamptz
            UNION ALL
            SELECT aoi.service_name, aoi.quantity, aoi.price FROM archived_order_items aoi
            JOIN archived_orders ao ON ao.id = aoi.archived_order_id
            WHERE ao.date::timestamptz >= $1::timestamptz AND ao.date::timestamptz <= $2::timestamptz
        ) combined
        GROUP BY service_name ORDER BY total_revenue DESC LIMIT 10`, [dateFrom, dateTo + ' 23:59:59']);
    return result.rows;
}

async function getReportTopCustomers(dateFrom, dateTo) {
    const result = await pool.query(`
        SELECT customer, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS total_spent
        FROM (
            SELECT customer, total FROM orders 
            WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz
            UNION ALL
            SELECT customer, total FROM archived_orders 
            WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz
        ) combined
        GROUP BY customer ORDER BY total_spent DESC LIMIT 10`, [dateFrom, dateTo + ' 23:59:59']);
    return result.rows;
}

async function getAllSettings() {
    const result = await pool.query("SELECT key, value FROM settings");
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    return settings;
}
async function updateSettings(data) {
    for (const key of Object.keys(data)) {
        await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [key, data[key] || '']);
    }
}

async function getCashiers() { const result = await pool.query("SELECT id, name, active, created_at FROM cashiers ORDER BY id ASC"); return result.rows; }
async function addCashier(name, pin) { const result = await pool.query("INSERT INTO cashiers (name, pin) VALUES ($1, $2) RETURNING id", [name, pin]); return result.rows[0].id; }
async function updateCashierPin(id, newPin) { await pool.query("UPDATE cashiers SET pin = $1 WHERE id = $2", [newPin, id]); }
async function deleteCashier(id) { await pool.query("DELETE FROM cashiers WHERE id = $1", [id]); }
async function findCashierByPin(pin) { const result = await pool.query("SELECT id, name FROM cashiers WHERE pin = $1 AND active = TRUE", [pin]); return result.rows[0]; }

async function getProducts(search, category) {
    const conditions = [];
    const params = [];
    if (search) { params.push('%' + search + '%'); conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`); }
    if (category && category !== 'All Categories') { params.push(category); conditions.push(`category = $${params.length}`); }
    let query = "SELECT * FROM products";
    if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY id DESC";
    const result = await pool.query(query, params);
    return result.rows;
}
async function getProductCategories() { const result = await pool.query("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != '' ORDER BY category"); return result.rows.map(r => r.category); }
async function addProduct(data) {
    const result = await pool.query(`INSERT INTO products (name, description, category, cost_price, selling_price, stock, low_limit, icon, image_data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [data.name, data.description || '', data.category || 'General', parseFloat(data.cost_price) || 0, parseFloat(data.selling_price) || 0, parseInt(data.stock) || 0, parseInt(data.low_limit) || 5, data.icon || '📦', data.image_data || null]);
    return result.rows[0].id;
}
async function updateProduct(id, data) {
    await pool.query(`UPDATE products SET name = $1, description = $2, category = $3, cost_price = $4, selling_price = $5, stock = $6, low_limit = $7, icon = $8, image_data = $9 WHERE id = $10`,
        [data.name, data.description || '', data.category || 'General', parseFloat(data.cost_price) || 0, parseFloat(data.selling_price) || 0, parseInt(data.stock) || 0, parseInt(data.low_limit) || 5, data.icon || '📦', data.image_data || null, id]);
}
async function deleteProduct(id) { await pool.query("DELETE FROM replenishments WHERE product_id = $1", [id]); await pool.query("DELETE FROM products WHERE id = $1", [id]); }
async function replenishProduct(id, quantity, cost, notes, supplier) {
    await pool.query("INSERT INTO replenishments (product_id, quantity, cost, notes, supplier) VALUES ($1, $2, $3, $4, $5)", [id, quantity, cost, notes || '', supplier || '']);
    await pool.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [quantity, id]);
}
async function getReplenishments() {
    const result = await pool.query(`SELECT r.id, r.quantity, r.cost, r.date, r.notes, r.supplier, p.name AS product_name, p.icon AS product_icon, p.image_data AS product_image FROM replenishments r JOIN products p ON p.id = r.product_id ORDER BY r.id DESC LIMIT 200`);
    return result.rows;
}
async function getLowStockProducts() { const result = await pool.query("SELECT id, name, stock, low_limit FROM products WHERE stock <= low_limit"); return result.rows; }

async function getExpenses(search, category, dateFrom, dateTo) {
    const conditions = [];
    const params = [];
    if (search) { params.push('%' + search + '%'); conditions.push(`(description ILIKE $${params.length} OR supplier ILIKE $${params.length})`); }
    if (category && category !== 'All Categories') { params.push(category); conditions.push(`category = $${params.length}`); }
    if (dateFrom) { params.push(dateFrom); conditions.push(`date::timestamptz >= $${params.length}::timestamptz`); }
    if (dateTo) { params.push(dateTo + ' 23:59:59'); conditions.push(`date::timestamptz <= $${params.length}::timestamptz`); }
    let query = "SELECT * FROM expenses";
    if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY date DESC LIMIT 500";
    const result = await pool.query(query, params);
    return result.rows;
}
async function getExpenseCategories() { const result = await pool.query("SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL ORDER BY category"); return result.rows.map(r => r.category); }
async function addExpense(data) {
    const result = await pool.query(`INSERT INTO expenses (category, description, amount, supplier, notes, si_or_number, account) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [data.category || 'Other', data.description || '', parseFloat(data.amount) || 0, data.supplier || '', data.notes || '', data.si_or_number || '', data.account || 'Operating Expense']);
    return result.rows[0].id;
}
async function updateExpense(id, data) {
    await pool.query(`UPDATE expenses SET category = $1, description = $2, amount = $3, supplier = $4, notes = $5, si_or_number = $6, account = $7 WHERE id = $8`,
        [data.category || 'Other', data.description || '', parseFloat(data.amount) || 0, data.supplier || '', data.notes || '', data.si_or_number || '', data.account || 'Operating Expense', id]);
}
async function deleteExpense(id) { await pool.query("DELETE FROM expenses WHERE id = $1", [id]); }

async function getUnifiedLedger(dateFrom, dateTo, search) {
    const params = [];
    const conditions = [];
    if (dateFrom) { params.push(dateFrom); conditions.push(`date::timestamptz >= $${params.length}::timestamptz`); }
    if (dateTo) { params.push(dateTo + ' 23:59:59'); conditions.push(`date::timestamptz <= $${params.length}::timestamptz`); }
    if (search) { params.push('%' + search + '%'); conditions.push(`(description ILIKE $${params.length} OR si_or_number ILIKE $${params.length} OR account ILIKE $${params.length})`); }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const query = `
        SELECT 'expense-' || e.id AS unique_id, e.id AS ref_id, e.date, COALESCE(e.description, e.category) AS description, e.si_or_number, COALESCE(e.account, 'Operating Expense') AS account, 'Manual' AS source, e.amount, e.category, e.supplier, e.notes
        FROM expenses e ${whereClause}
        UNION ALL
        SELECT 'replenish-' || r.id AS unique_id, r.id AS ref_id, r.date, 'Inventory replenishment — ' || p.name AS description, 'REF-' || LPAD(r.id::TEXT, 5, '0') AS si_or_number, 'Merchandise Inventory' AS account, 'Replenishment' AS source, (r.cost * r.quantity) AS amount, 'Inventory' AS category, r.supplier, r.notes
        FROM replenishments r JOIN products p ON p.id = r.product_id
        ORDER BY date DESC LIMIT 500
    `;
    const result = await pool.query(query, params);
    return result.rows;
}

async function getLedgerStats(dateFrom, dateTo) {
    const params = [];
    const conditions = [];
    if (dateFrom) { params.push(dateFrom); conditions.push(`date::timestamptz >= $${params.length}::timestamptz`); }
    if (dateTo) { params.push(dateTo + ' 23:59:59'); conditions.push(`date::timestamptz <= $${params.length}::timestamptz`); }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const query = `
        SELECT SUM(amount) AS total, COUNT(*) AS count, MAX(amount) AS highest
        FROM (
            SELECT amount FROM expenses ${whereClause}
            UNION ALL
            SELECT (r.cost * r.quantity) AS amount FROM replenishments r
        ) combined
    `;
    const result = await pool.query(query, [...params, ...params]);
    const row = result.rows[0];
    const total = parseFloat(row.total) || 0;
    const count = parseInt(row.count) || 0;
    return { total, count, highest: parseFloat(row.highest) || 0, average: count > 0 ? total / count : 0 };
}

// ====== USERS (Login System) ======
async function getUserByUsername(username) {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    return result.rows[0];
}

async function getUserByEmail(email) {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    return result.rows[0];
}

async function getUserById(id) {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return result.rows[0];
}

async function getAllUsers() {
    const result = await pool.query("SELECT id, username, email, full_name, role, created_at, last_login FROM users ORDER BY id ASC");
    return result.rows;
}

async function getUserCount() {
    const result = await pool.query("SELECT COUNT(*) AS count FROM users");
    return parseInt(result.rows[0].count);
}

async function createUser(data) {
    const result = await pool.query(
        `INSERT INTO users (username, password_hash, email, full_name, role, security_question, security_answer_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [data.username, data.password_hash, data.email || null, data.full_name || null,
         data.role || 'admin', data.security_question || null, data.security_answer_hash || null]
    );
    return result.rows[0].id;
}

async function updateUserPassword(id, password_hash) {
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [password_hash, id]);
}

async function updateLastLogin(id) {
    await pool.query("UPDATE users SET last_login = NOW() WHERE id = $1", [id]);
}

async function setResetToken(id, token, expires) {
    await pool.query("UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3", [token, expires, id]);
}

async function getUserByResetToken(token) {
    const result = await pool.query("SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()", [token]);
    return result.rows[0];
}

async function clearResetToken(id) {
    await pool.query("UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = $1", [id]);
}

async function deleteUser(id) {
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
}

async function updateUserRole(id, role) {
    await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]);
}

module.exports = {
    pool, getServices, addService, updateService, deleteService, saveOrder, getOrders,
    markAsPaid, markAsUnpaid, deleteOrder, updateOrderStatus,
    getCustomers, getCustomer, addCustomer, updateCustomer, deleteCustomer, getCustomerOrders,
    getReportSummary, getReportDaily, getReportTopServices, getReportTopCustomers,
    getAllSettings, updateSettings,
    getCashiers, addCashier, updateCashierPin, deleteCashier, findCashierByPin,
    getProducts, getProductCategories, addProduct, updateProduct, deleteProduct,
    replenishProduct, getReplenishments, getLowStockProducts,
    getExpenses, getExpenseCategories, addExpense, updateExpense, deleteExpense,
    getUnifiedLedger, getLedgerStats,
    getUserByUsername, getUserByEmail, getUserById, getAllUsers, getUserCount,
    createUser, updateUserPassword, updateLastLogin, setResetToken,
    getUserByResetToken, clearResetToken, deleteUser, updateUserRole
};