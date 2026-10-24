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
        await pool.query(`ALTER TABLE replenishments ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Supplies';`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#4f46e5';`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS service_type TEXT DEFAULT 'Per Load';`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS minimum NUMERIC DEFAULT 1;`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS unit_label TEXT DEFAULT 'kg';`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS image_data TEXT;`);
        await pool.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;`);
        await pool.query(`CREATE TABLE IF NOT EXISTS service_materials (id SERIAL PRIMARY KEY, service_id INTEGER REFERENCES services(id) ON DELETE CASCADE, product_id INTEGER REFERENCES products(id), quantity INTEGER DEFAULT 1, amount NUMERIC DEFAULT 0);`);

        await pool.query(`CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY, user_id INTEGER, username TEXT, user_role TEXT,
            action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, description TEXT,
            old_values JSONB, new_values JSONB, ip_address TEXT, user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        );`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);`);

        await pool.query(`CREATE TABLE IF NOT EXISTS expenses (id SERIAL PRIMARY KEY, date TIMESTAMPTZ DEFAULT NOW(), category TEXT NOT NULL, description TEXT, amount NUMERIC NOT NULL, supplier TEXT, notes TEXT, si_or_number TEXT, account TEXT DEFAULT 'Operating Expense');`);
        await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS si_or_number TEXT;`);
        await pool.query(`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account TEXT DEFAULT 'Operating Expense';`);

        await pool.query(`CREATE TABLE IF NOT EXISTS archived_orders (id SERIAL PRIMARY KEY, original_id INTEGER, date TEXT NOT NULL, customer TEXT NOT NULL, total NUMERIC NOT NULL, payment_status TEXT NOT NULL, status TEXT, cashier_name TEXT, archived_at TIMESTAMPTZ DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS archived_order_items (id SERIAL PRIMARY KEY, archived_order_id INTEGER REFERENCES archived_orders(id), service_name TEXT, quantity INTEGER, price NUMERIC);`);

        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, email TEXT, full_name TEXT, role TEXT DEFAULT 'admin', security_question TEXT, security_answer_hash TEXT, reset_token TEXT, reset_token_expires TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), last_login TIMESTAMPTZ);`);

        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS service_flow JSONB;`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 0;`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_delivery BOOLEAN DEFAULT FALSE;`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS rider_name TEXT;`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_history JSONB DEFAULT '[]'::jsonb;`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT NOW();`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;`);

        // ===== VOID COLUMNS =====
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided BOOLEAN DEFAULT FALSE;`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS void_reason TEXT;`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided_by TEXT;`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;`);

        await pool.query(`CREATE TABLE IF NOT EXISTS service_flows (
            id SERIAL PRIMARY KEY, name TEXT NOT NULL, flow_key TEXT NOT NULL UNIQUE,
            steps JSONB NOT NULL, is_custom BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW()
        );`);

        const defaultFlows = [
            { name: 'Wash + Dry + Fold', key: 'wash_dry_fold', steps: ['Received', 'Washing', 'Drying', 'Folding', 'Done (Ready to Pickup)'] },
            { name: 'Wash + Dry', key: 'wash_dry', steps: ['Received', 'Washing', 'Drying', 'Done (Ready to Pickup)'] },
            { name: 'Wash Only', key: 'wash_only', steps: ['Received', 'Washing', 'Done (Ready to Pickup)'] },
            { name: 'Dry Only (Spin & Dry)', key: 'dry_only', steps: ['Received', 'Spin & Dry', 'Done (Ready to Pickup)'] },
            { name: 'Fold Only', key: 'fold_only', steps: ['Received', 'Folding', 'Done (Ready to Pickup)'] },
            { name: 'Pickup / Delivery Only', key: 'pickup_delivery', steps: ['Received', 'Done (Ready to Pickup)'] }
        ];
        for (const f of defaultFlows) {
            await pool.query(
                `INSERT INTO service_flows (name, flow_key, steps, is_custom) VALUES ($1, $2, $3, FALSE) ON CONFLICT (flow_key) DO NOTHING`,
                [f.name, f.key, JSON.stringify(f.steps)]
            );
        }

        await pool.query(`CREATE TABLE IF NOT EXISTS assets (
            id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT DEFAULT 'Equipment',
            purchase_price NUMERIC NOT NULL DEFAULT 0, purchase_date DATE DEFAULT CURRENT_DATE,
            useful_life_months INTEGER DEFAULT 60, salvage_value NUMERIC DEFAULT 0,
            notes TEXT, status TEXT DEFAULT 'Active', created_at TIMESTAMPTZ DEFAULT NOW()
        );`);

        await pool.query(`CREATE TABLE IF NOT EXISTS capital_investments (
            id SERIAL PRIMARY KEY, description TEXT NOT NULL, amount NUMERIC NOT NULL DEFAULT 0,
            category TEXT DEFAULT 'Startup', date DATE DEFAULT CURRENT_DATE,
            notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
        );`);

        await pool.query(`CREATE TABLE IF NOT EXISTS liabilities (
            id SERIAL PRIMARY KEY, description TEXT NOT NULL, category TEXT DEFAULT 'Loan',
            amount NUMERIC NOT NULL DEFAULT 0, amount_paid NUMERIC DEFAULT 0,
            date DATE DEFAULT CURRENT_DATE, due_date DATE, notes TEXT,
            status TEXT DEFAULT 'Active', created_at TIMESTAMPTZ DEFAULT NOW()
        );`);

        await pool.query(`CREATE TABLE IF NOT EXISTS owner_withdrawals (
            id SERIAL PRIMARY KEY, description TEXT NOT NULL, amount NUMERIC NOT NULL DEFAULT 0,
            date DATE DEFAULT CURRENT_DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
        );`);

        await pool.query(`CREATE TABLE IF NOT EXISTS bookings (
            id SERIAL PRIMARY KEY, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
            customer_address TEXT NOT NULL, service_type TEXT, preferred_date DATE NOT NULL,
            preferred_time TEXT NOT NULL, notes TEXT, status TEXT DEFAULT 'Pending',
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
        );`);

        await pool.query(`UPDATE services SET service_type = 'wash_dry_fold' WHERE service_type IS NULL OR service_type = 'Per Load';`);

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

        await pool.query(`DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '365 days'`);

        console.log('Database initialized.');
    } catch (err) {
        console.error('Database init error:', err.message);
    }
}

initDatabase();

// ===== AUDIT =====
async function logAudit(data) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (user_id, username, user_role, action, entity_type, entity_id, description, old_values, new_values, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [data.user_id || null, data.username || 'system', data.user_role || null,
             data.action, data.entity_type, data.entity_id || null, data.description || null,
             data.old_values ? JSON.stringify(data.old_values) : null,
             data.new_values ? JSON.stringify(data.new_values) : null,
             data.ip_address || null, data.user_agent || null]
        );
    } catch (err) { console.error('Audit error:', err.message); }
}

async function getAuditLogs(search, entity_type, action, dateFrom, dateTo) {
    const conditions = [];
    const params = [];
    if (search) { params.push('%' + search + '%'); conditions.push(`(description ILIKE $${params.length} OR username ILIKE $${params.length})`); }
    if (entity_type && entity_type !== 'all') { params.push(entity_type); conditions.push(`entity_type = $${params.length}`); }
    if (action && action !== 'all') { params.push(action); conditions.push(`action = $${params.length}`); }
    if (dateFrom) { params.push(dateFrom); conditions.push(`created_at::timestamptz >= $${params.length}::timestamptz`); }
    if (dateTo) { params.push(dateTo + ' 23:59:59'); conditions.push(`created_at::timestamptz <= $${params.length}::timestamptz`); }
    let query = "SELECT * FROM audit_logs";
    if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY created_at DESC LIMIT 500";
    const result = await pool.query(query, params);
    return result.rows;
}

async function getAuditStats() {
    const result = await pool.query(`
        SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE created_at::timestamptz >= NOW() - INTERVAL '24 hours') AS last_24h,
            COUNT(*) FILTER (WHERE created_at::timestamptz >= NOW() - INTERVAL '7 days') AS last_7d,
            COUNT(DISTINCT username) AS unique_users
        FROM audit_logs`);
    return result.rows[0];
}

async function getFinancialAuditSummary(dateFrom, dateTo) {
    const params = [];
    let dateFilter = '';
    if (dateFrom && dateTo) { params.push(dateFrom, dateTo + ' 23:59:59'); dateFilter = `AND date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`; }
    else if (dateFrom) { params.push(dateFrom); dateFilter = `AND date::timestamptz >= $1::timestamptz`; }
    else if (dateTo) { params.push(dateTo + ' 23:59:59'); dateFilter = `AND date::timestamptz <= $1::timestamptz`; }

    const revRes = await pool.query(`SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS cnt FROM orders WHERE archived_at IS NULL AND voided = FALSE ${dateFilter}`, params);
    const totalRevenue = parseFloat(revRes.rows[0].total) || 0;
    const orderCount = parseInt(revRes.rows[0].cnt) || 0;

    const expRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM expenses WHERE 1=1 ${dateFilter}`, params);
    const totalExpenses = parseFloat(expRes.rows[0].total) || 0;
    const expenseCount = parseInt(expRes.rows[0].cnt) || 0;

    const repRes = await pool.query(`SELECT COALESCE(SUM(cost * quantity), 0) AS total, COUNT(*) AS cnt FROM replenishments WHERE 1=1 ${dateFilter}`, params);
    const totalReplenish = parseFloat(repRes.rows[0].total) || 0;
    const replenishCount = parseInt(repRes.rows[0].cnt) || 0;

    const catRes = await pool.query(`SELECT category, COALESCE(SUM(cost * quantity), 0) AS total FROM replenishments WHERE 1=1 ${dateFilter} GROUP BY category ORDER BY total DESC`, params);

    const totalSpent = totalExpenses + totalReplenish;
    const netProfit = totalRevenue - totalSpent;
    const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    return { revenue: totalRevenue, orderCount, expenses: totalExpenses, expenseCount, replenishments: totalReplenish, replenishCount, categories: catRes.rows, totalSpent, netProfit, margin };
}

async function getCashOnHand(dateFrom, dateTo) {
    const params = [];
    let dateFilter = '';
    if (dateFrom && dateTo) { params.push(dateFrom, dateTo + ' 23:59:59'); dateFilter = `AND date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`; }
    else if (dateFrom) { params.push(dateFrom); dateFilter = `AND date::timestamptz >= $1::timestamptz`; }
    else if (dateTo) { params.push(dateTo + ' 23:59:59'); dateFilter = `AND date::timestamptz <= $1::timestamptz`; }

    const paidRes = await pool.query(`SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE archived_at IS NULL AND voided = FALSE AND payment_status = 'Paid' ${dateFilter}`, params);
    const unpaidRes = await pool.query(`SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE archived_at IS NULL AND voided = FALSE AND payment_status = 'Pending' ${dateFilter}`, params);
    const expRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE 1=1 ${dateFilter}`, params);
    const repRes = await pool.query(`SELECT COALESCE(SUM(cost * quantity), 0) AS total FROM replenishments WHERE 1=1 ${dateFilter}`, params);
    const capRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM capital_investments WHERE 1=1 ${dateFilter}`, params);
    const wdRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM owner_withdrawals WHERE 1=1 ${dateFilter}`, params);

    const paidRevenue = parseFloat(paidRes.rows[0].total) || 0;
    const unpaidRevenue = parseFloat(unpaidRes.rows[0].total) || 0;
    const totalExpenses = parseFloat(expRes.rows[0].total) || 0;
    const totalReplenish = parseFloat(repRes.rows[0].total) || 0;
    const totalCapital = parseFloat(capRes.rows[0].total) || 0;
    const totalWithdrawals = parseFloat(wdRes.rows[0].total) || 0;

    const cashOnHand = paidRevenue + totalCapital - totalExpenses - totalReplenish - totalWithdrawals;
    return { paidRevenue, unpaidRevenue, totalExpenses, totalReplenish, totalCapital, totalWithdrawals, totalOutflow: totalExpenses + totalReplenish + totalWithdrawals, cashOnHand };
}

// ===== FINANCIAL STATEMENTS =====
async function getIncomeStatement(dateFrom, dateTo) {
    const params = [dateFrom, dateTo + ' 23:59:59'];
    const revByServiceRes = await pool.query(`
        SELECT oi.service_name, COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue, COALESCE(SUM(oi.quantity), 0) AS total_qty
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.archived_at IS NULL AND o.voided = FALSE AND o.date::timestamptz >= $1::timestamptz AND o.date::timestamptz <= $2::timestamptz
        GROUP BY oi.service_name ORDER BY revenue DESC`, params);
    const revenueByService = revByServiceRes.rows.map(r => ({ service: r.service_name, revenue: parseFloat(r.revenue) || 0, qty: parseFloat(r.total_qty) || 0 }));
    const revenue = revenueByService.reduce((s, r) => s + r.revenue, 0);

    const orderCountRes = await pool.query(`SELECT COUNT(*) AS count FROM orders WHERE archived_at IS NULL AND voided = FALSE AND date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`, params);
    const orderCount = parseInt(orderCountRes.rows[0].count) || 0;

    const cogsRes = await pool.query(`SELECT COALESCE(SUM(cost * quantity), 0) AS total FROM replenishments WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`, params);
    const cogs = parseFloat(cogsRes.rows[0].total) || 0;

    const expRes = await pool.query(`SELECT category, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz GROUP BY category ORDER BY total DESC`, params);
    const operatingExpenses = expRes.rows.map(r => ({ category: r.category, amount: parseFloat(r.total) || 0 }));
    const totalOperatingExpenses = operatingExpenses.reduce((s, e) => s + e.amount, 0);

    const assetsRes = await pool.query(`SELECT * FROM assets WHERE status = 'Active'`);
    let depreciation = 0;
    const monthCount = Math.max(1, (new Date(dateTo) - new Date(dateFrom)) / (30 * 24 * 60 * 60 * 1000));
    for (const a of assetsRes.rows) {
        const price = parseFloat(a.purchase_price) || 0;
        const salvage = parseFloat(a.salvage_value) || 0;
        const lifeMonths = parseInt(a.useful_life_months) || 60;
        const monthlyDep = (price - salvage) / lifeMonths;
        depreciation += monthlyDep * monthCount;
    }

    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - totalOperatingExpenses - depreciation;
    const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;
    const avgRevenuePerLoad = orderCount > 0 ? revenue / orderCount : 0;

    return { revenue, revenueByService, orderCount, cogs, grossProfit, grossMargin, operatingExpenses, totalOperatingExpenses, depreciation, netProfit, netMargin, avgRevenuePerLoad };
}

async function getBalanceSheet(dateTo) {
    const endDate = dateTo + ' 23:59:59';
    const paidRes = await pool.query(`SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE archived_at IS NULL AND voided = FALSE AND payment_status = 'Paid' AND date::timestamptz <= $1::timestamptz`, [endDate]);
    const expRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date::timestamptz <= $1::timestamptz`, [endDate]);
    const repRes = await pool.query(`SELECT COALESCE(SUM(cost * quantity), 0) AS total FROM replenishments WHERE date::timestamptz <= $1::timestamptz`, [endDate]);
    const capRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM capital_investments WHERE date::timestamptz <= $1::timestamptz`, [endDate]);
    const wdRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM owner_withdrawals WHERE date::timestamptz <= $1::timestamptz`, [endDate]);
    const loanRecRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM liabilities WHERE date::timestamptz <= $1::timestamptz`, [endDate]);
    const loanPaidRes = await pool.query(`SELECT COALESCE(SUM(amount_paid), 0) AS total FROM liabilities WHERE date::timestamptz <= $1::timestamptz`, [endDate]);

    const cash = (parseFloat(paidRes.rows[0].total) || 0) + (parseFloat(capRes.rows[0].total) || 0) + (parseFloat(loanRecRes.rows[0].total) || 0) - (parseFloat(expRes.rows[0].total) || 0) - (parseFloat(repRes.rows[0].total) || 0) - (parseFloat(wdRes.rows[0].total) || 0) - (parseFloat(loanPaidRes.rows[0].total) || 0);

    const invRes = await pool.query(`SELECT COALESCE(SUM(stock * cost_price), 0) AS total FROM products`);
    const inventory = parseFloat(invRes.rows[0].total) || 0;

    const assetsRes = await pool.query(`SELECT * FROM assets WHERE status = 'Active'`);
    let equipmentCost = 0;
    let accDep = 0;
    const now = new Date();
    for (const a of assetsRes.rows) {
        const price = parseFloat(a.purchase_price) || 0;
        const salvage = parseFloat(a.salvage_value) || 0;
        const lifeMonths = parseInt(a.useful_life_months) || 60;
        equipmentCost += price;
        const monthsOwned = Math.floor((now - new Date(a.purchase_date)) / (30 * 24 * 60 * 60 * 1000));
        const totalDep = Math.max(0, price - salvage);
        accDep += (totalDep / lifeMonths) * Math.min(monthsOwned, lifeMonths);
    }
    const equipmentNet = equipmentCost - accDep;

    const arRes = await pool.query(`SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE archived_at IS NULL AND voided = FALSE AND payment_status = 'Pending' AND date::timestamptz <= $1::timestamptz`, [endDate]);
    const accountsReceivable = parseFloat(arRes.rows[0].total) || 0;

    const totalAssets = cash + inventory + equipmentNet + accountsReceivable;

    const liabRes = await pool.query(`SELECT id, description, category, amount, amount_paid FROM liabilities WHERE date::timestamptz <= $1::timestamptz AND (amount - COALESCE(amount_paid, 0)) > 0 ORDER BY date`, [endDate]);
    const liabilitiesList = liabRes.rows.map(l => ({ id: l.id, description: l.description, category: l.category, outstanding: (parseFloat(l.amount) || 0) - (parseFloat(l.amount_paid) || 0) }));
    const totalLiabilities = liabilitiesList.reduce((s, l) => s + l.outstanding, 0);

    const totalCapital = parseFloat(capRes.rows[0].total) || 0;
    const totalWithdrawals = parseFloat(wdRes.rows[0].total) || 0;
    const retainedEarnings = totalAssets - totalCapital + totalWithdrawals - totalLiabilities;
    const totalEquity = totalCapital - totalWithdrawals + retainedEarnings;

    return { cash, inventory, equipmentCost, accumulatedDepreciation: accDep, equipmentNet, accountsReceivable, totalAssets, liabilitiesList, totalLiabilities, totalCapital, totalWithdrawals, retainedEarnings, totalEquity, balanceCheck: totalAssets - (totalLiabilities + totalEquity) };
}

async function getCashFlowStatement(dateFrom, dateTo) {
    const params = [dateFrom, dateTo + ' 23:59:59'];
    const paidRes = await pool.query(`SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE archived_at IS NULL AND voided = FALSE AND payment_status = 'Paid' AND date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`, params);
    const repRes = await pool.query(`SELECT COALESCE(SUM(cost * quantity), 0) AS total FROM replenishments WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`, params);
    const expRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`, params);
    const assetRes = await pool.query(`SELECT COALESCE(SUM(purchase_price), 0) AS total FROM assets WHERE purchase_date >= $1::date AND purchase_date <= $2::date`, [dateFrom, dateTo]);
    const capRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM capital_investments WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`, params);
    const wdRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM owner_withdrawals WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`, params);
    const loanRecRes = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM liabilities WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`, params);
    const loanPaidRes = await pool.query(`SELECT COALESCE(SUM(amount_paid), 0) AS total FROM liabilities WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz`, params);

    const cashFromCustomers = parseFloat(paidRes.rows[0].total) || 0;
    const cashPaidForSupplies = parseFloat(repRes.rows[0].total) || 0;
    const cashPaidForExpenses = parseFloat(expRes.rows[0].total) || 0;
    const cashPaidForAssets = parseFloat(assetRes.rows[0].total) || 0;
    const cashFromCapital = parseFloat(capRes.rows[0].total) || 0;
    const cashFromWithdrawals = -(parseFloat(wdRes.rows[0].total) || 0);
    const cashFromLoans = parseFloat(loanRecRes.rows[0].total) || 0;
    const cashPaidForLoans = -(parseFloat(loanPaidRes.rows[0].total) || 0);

    const netOperating = cashFromCustomers - cashPaidForSupplies - cashPaidForExpenses;
    const netInvesting = -cashPaidForAssets;
    const netFinancing = cashFromCapital + cashFromWithdrawals + cashFromLoans + cashPaidForLoans;
    const netCashChange = netOperating + netInvesting + netFinancing;

    const bPaid = await pool.query(`SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE archived_at IS NULL AND voided = FALSE AND payment_status = 'Paid' AND date::timestamptz < $1::timestamptz`, [dateFrom]);
    const bExp = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE date::timestamptz < $1::timestamptz`, [dateFrom]);
    const bRep = await pool.query(`SELECT COALESCE(SUM(cost * quantity), 0) AS total FROM replenishments WHERE date::timestamptz < $1::timestamptz`, [dateFrom]);
    const bCap = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM capital_investments WHERE date::timestamptz < $1::timestamptz`, [dateFrom]);
    const bWd = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM owner_withdrawals WHERE date::timestamptz < $1::timestamptz`, [dateFrom]);
    const bLoan = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM liabilities WHERE date::timestamptz < $1::timestamptz`, [dateFrom]);
    const bLoanPaid = await pool.query(`SELECT COALESCE(SUM(amount_paid), 0) AS total FROM liabilities WHERE date::timestamptz < $1::timestamptz`, [dateFrom]);

    const beginningCash = (parseFloat(bPaid.rows[0].total) || 0) + (parseFloat(bCap.rows[0].total) || 0) + (parseFloat(bLoan.rows[0].total) || 0) - (parseFloat(bExp.rows[0].total) || 0) - (parseFloat(bRep.rows[0].total) || 0) - (parseFloat(bWd.rows[0].total) || 0) - (parseFloat(bLoanPaid.rows[0].total) || 0);
    const endingCash = beginningCash + netCashChange;

    return { cashFromCustomers, cashPaidForSupplies, cashPaidForExpenses, netOperating, cashPaidForAssets, netInvesting, cashFromCapital, cashFromWithdrawals, cashFromLoans, cashPaidForLoans, netFinancing, netCashChange, beginningCash, endingCash };
}

// ===== LIABILITIES =====
async function getLiabilities() {
    const result = await pool.query("SELECT * FROM liabilities ORDER BY date DESC, id DESC");
    return result.rows;
}

async function addLiability(data) {
    const result = await pool.query(
        `INSERT INTO liabilities (description, category, amount, date, due_date, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [data.description, data.category || 'Loan', parseFloat(data.amount) || 0, data.date || new Date().toISOString().split('T')[0], data.due_date || null, data.notes || '']
    );
    return result.rows[0];
}

async function updateLiability(id, data) {
    await pool.query(`UPDATE liabilities SET description = $1, category = $2, amount = $3, amount_paid = $4, date = $5, due_date = $6, notes = $7, status = $8 WHERE id = $9`,
        [data.description, data.category || 'Loan', parseFloat(data.amount) || 0, parseFloat(data.amount_paid) || 0, data.date, data.due_date || null, data.notes || '', data.status || 'Active', id]);
}

async function deleteLiability(id) { await pool.query("DELETE FROM liabilities WHERE id = $1", [id]); }
async function payLiability(id, amount) {
    await pool.query(`UPDATE liabilities SET amount_paid = amount_paid + $1, status = CASE WHEN amount_paid + $1 >= amount THEN 'Paid' ELSE 'Active' END WHERE id = $2`, [parseFloat(amount) || 0, id]);
}

// ===== OWNER WITHDRAWALS =====
async function getOwnerWithdrawals() {
    const result = await pool.query("SELECT * FROM owner_withdrawals ORDER BY date DESC, id DESC");
    return result.rows;
}

async function addOwnerWithdrawal(data) {
    const result = await pool.query(`INSERT INTO owner_withdrawals (description, amount, date, notes) VALUES ($1, $2, $3, $4) RETURNING *`,
        [data.description, parseFloat(data.amount) || 0, data.date || new Date().toISOString().split('T')[0], data.notes || '']);
    return result.rows[0];
}

async function deleteOwnerWithdrawal(id) { await pool.query("DELETE FROM owner_withdrawals WHERE id = $1", [id]); }

// ===== SERVICES =====
async function getServices() {
    const result = await pool.query("SELECT * FROM services WHERE status = 'Available' ORDER BY id ASC");
    const services = result.rows;
    for (const s of services) {
        const mats = await pool.query(`SELECT sm.id, sm.product_id, sm.quantity, sm.amount, p.name AS product_name FROM service_materials sm LEFT JOIN products p ON p.id = sm.product_id WHERE sm.service_id = $1`, [s.id]);
        s.materials = mats.rows;
    }
    return services;
}

async function getPickupService() {
    const result = await pool.query("SELECT * FROM services WHERE status = 'Available' AND (LOWER(name) LIKE '%pickup%' OR LOWER(name) LIKE '%delivery%') LIMIT 1");
    return result.rows[0] || null;
}

async function getAllServiceFlows() {
    const result = await pool.query("SELECT * FROM service_flows ORDER BY is_custom ASC, id ASC");
    return result.rows;
}

async function addServiceFlow(name, steps) {
    const flow_key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now().toString(36);
    const result = await pool.query(`INSERT INTO service_flows (name, flow_key, steps, is_custom) VALUES ($1, $2, $3, TRUE) RETURNING *`, [name, flow_key, JSON.stringify(steps)]);
    return result.rows[0];
}

async function updateServiceFlow(id, name, steps) { await pool.query(`UPDATE service_flows SET name = $1, steps = $2 WHERE id = $3 AND is_custom = TRUE`, [name, JSON.stringify(steps), id]); }
async function deleteServiceFlow(id) { await pool.query(`DELETE FROM service_flows WHERE id = $1 AND is_custom = TRUE`, [id]); }
async function getServiceFlowByKey(flow_key) { const result = await pool.query("SELECT * FROM service_flows WHERE flow_key = $1", [flow_key]); return result.rows[0]; }

async function addService(data) {
    const result = await pool.query(`INSERT INTO services (name, price, unit, status, color, service_type, minimum, unit_label, image_data, hidden) VALUES ($1, $2, $3, 'Available', $4, $5, $6, $7, $8, $9) RETURNING id`,
        [data.name, parseFloat(data.price) || 0, data.unit_label || 'kg', data.color || '#4f46e5', data.service_type || 'Per Load', parseFloat(data.minimum) || 1, data.unit_label || 'kg', data.image_data || null, data.hidden || false]);
    const serviceId = result.rows[0].id;
    if (Array.isArray(data.materials)) {
        for (const m of data.materials) {
            if (m.product_id && m.quantity > 0) {
                await pool.query(`INSERT INTO service_materials (service_id, product_id, quantity, amount) VALUES ($1, $2, $3, $4)`, [serviceId, m.product_id, parseInt(m.quantity) || 1, parseFloat(m.amount) || 0]);
            }
        }
    }
    return serviceId;
}

async function updateService(id, data) {
    await pool.query(`UPDATE services SET name = $1, price = $2, unit = $3, color = $4, service_type = $5, minimum = $6, unit_label = $7, image_data = $8, hidden = $9 WHERE id = $10`,
        [data.name, parseFloat(data.price) || 0, data.unit_label || 'kg', data.color || '#4f46e5', data.service_type || 'Per Load', parseFloat(data.minimum) || 1, data.unit_label || 'kg', data.image_data || null, data.hidden || false, id]);
    await pool.query("DELETE FROM service_materials WHERE service_id = $1", [id]);
    if (Array.isArray(data.materials)) {
        for (const m of data.materials) {
            if (m.product_id && m.quantity > 0) {
                await pool.query(`INSERT INTO service_materials (service_id, product_id, quantity, amount) VALUES ($1, $2, $3, $4)`, [id, m.product_id, parseInt(m.quantity) || 1, parseFloat(m.amount) || 0]);
            }
        }
    }
}

async function deleteService(id) {
    await pool.query("DELETE FROM service_materials WHERE service_id = $1", [id]);
    await pool.query("DELETE FROM services WHERE id = $1", [id]);
}

// ===== ORDERS =====
async function saveOrder(customer, total, cartItems, paymentStatus, cashierName, pickupDelivery = false, customerPhone = null, serviceFlow = ['Received']) {
    const date = new Date().toISOString();
    const status = paymentStatus || 'Pending';
    const orderResult = await pool.query(
        `INSERT INTO orders (date, customer, total, payment_status, cashier_name, status, service_flow, current_step, pickup_delivery, customer_phone, status_history, status_updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Received', $6, 0, $7, $8, $9, NOW()) RETURNING id`,
        [date, customer, total, status, cashierName || 'Admin', JSON.stringify(serviceFlow), pickupDelivery || false, customerPhone || null, JSON.stringify([{ status: 'Received', at: new Date().toISOString(), by: cashierName || 'Admin' }])]
    );
    const orderId = orderResult.rows[0].id;
    for (const item of cartItems) {
        await pool.query("INSERT INTO order_items (order_id, service_name, quantity, price) VALUES ($1, $2, $3, $4)", [orderId, item.name, item.qty, item.price]);
        if (item.type === 'addon') {
            await pool.query("UPDATE products SET stock = GREATEST(stock - $1, 0) WHERE name = $2", [item.qty, item.name]);
        }
        if (item.type === 'service' && !item.isPickupFee) {
            const svc = await pool.query("SELECT id FROM services WHERE name = $1", [item.name]);
            if (svc.rows.length > 0) {
                const mats = await pool.query("SELECT product_id, quantity FROM service_materials WHERE service_id = $1", [svc.rows[0].id]);
                for (const m of mats.rows) {
                    await pool.query("UPDATE products SET stock = GREATEST(stock - ($1 * $2), 0) WHERE id = $3", [m.quantity, item.qty, m.product_id]);
                }
            }
        }
    }
    return orderId;
}

async function getOrders(filter, search, dateFrom, dateTo) {
    const conditions = ["archived_at IS NULL"];
    const params = [];
    if (filter === 'voided') conditions.push("voided = TRUE");
    else conditions.push("voided = FALSE");
    if (filter === 'paid') conditions.push("payment_status = 'Paid'");
    else if (filter === 'unpaid') conditions.push("payment_status = 'Pending'");
    else if (filter === 'received') conditions.push("status = 'Received'");
    else if (filter === 'washing') conditions.push("status = 'Washing'");
    else if (filter === 'drying') conditions.push("status = 'Drying'");
    else if (filter === 'ready') conditions.push("status = 'Done (Ready to Pickup)'");
    else if (filter === 'pickedup') conditions.push("status IN ('Delivered', 'Picked Up')");
    if (search) { params.push('%' + search + '%'); params.push(search); conditions.push(`(customer ILIKE $${params.length - 1} OR CAST(id AS TEXT) = $${params.length})`); }
    if (dateFrom) { params.push(dateFrom); conditions.push(`date::timestamptz >= $${params.length}::timestamptz`); }
    if (dateTo) { params.push(dateTo + ' 23:59:59'); conditions.push(`date::timestamptz <= $${params.length}::timestamptz`); }
    let query = "SELECT id, date, customer, total, payment_status, COALESCE(status, 'Received') AS status, cashier_name, service_flow, current_step, pickup_delivery, customer_phone, rider_name, archived_at, voided, void_reason, voided_by, voided_at FROM orders";
    query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY id DESC LIMIT 500";
    const result = await pool.query(query, params);
    return result.rows;
}

async function getArchivedOrders(filter, search) {
    const conditions = ["archived_at IS NOT NULL"];
    const params = [];
    if (search) { params.push('%' + search + '%'); params.push(search); conditions.push(`(customer ILIKE $${params.length - 1} OR CAST(id AS TEXT) = $${params.length})`); }
    let query = "SELECT id, date, customer, total, payment_status, COALESCE(status, 'Received') AS status, cashier_name, service_flow, current_step, pickup_delivery, customer_phone, rider_name, archived_at, voided, void_reason, voided_by, voided_at FROM orders";
    query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY archived_at DESC LIMIT 500";
    const result = await pool.query(query, params);
    return result.rows;
}

async function getOrderById(id) { const result = await pool.query("SELECT * FROM orders WHERE id = $1", [id]); return result.rows[0]; }

// ===== VOID =====
async function voidOrder(id, reason, voidedBy) {
    const order = await getOrderById(id);
    if (!order) throw new Error('Order not found');
    if (order.voided) throw new Error('Order is already voided');
    if (order.archived_at) throw new Error('Cannot void an archived order');

    const items = await pool.query("SELECT service_name, quantity FROM order_items WHERE order_id = $1", [id]);

    for (const item of items.rows) {
        const prod = await pool.query("SELECT id FROM products WHERE name = $1", [item.service_name]);
        if (prod.rows.length > 0) {
            await pool.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [item.quantity, prod.rows[0].id]);
            continue;
        }
        const svc = await pool.query("SELECT id FROM services WHERE name = $1", [item.service_name]);
        if (svc.rows.length > 0) {
            const mats = await pool.query("SELECT product_id, quantity FROM service_materials WHERE service_id = $1", [svc.rows[0].id]);
            for (const m of mats.rows) {
                await pool.query("UPDATE products SET stock = stock + ($1 * $2) WHERE id = $3", [m.quantity, item.quantity, m.product_id]);
            }
        }
    }

    await pool.query(
        `UPDATE orders SET voided = TRUE, void_reason = $1, voided_by = $2, voided_at = NOW() WHERE id = $3`,
        [reason, voidedBy, id]
    );
    return { success: true };
}

async function unvoidOrder(id) {
    const order = await getOrderById(id);
    if (!order) throw new Error('Order not found');
    if (!order.voided) throw new Error('Order is not voided');

    const items = await pool.query("SELECT service_name, quantity FROM order_items WHERE order_id = $1", [id]);

    for (const item of items.rows) {
        const prod = await pool.query("SELECT id FROM products WHERE name = $1", [item.service_name]);
        if (prod.rows.length > 0) {
            await pool.query("UPDATE products SET stock = GREATEST(stock - $1, 0) WHERE id = $2", [item.quantity, prod.rows[0].id]);
            continue;
        }
        const svc = await pool.query("SELECT id FROM services WHERE name = $1", [item.service_name]);
        if (svc.rows.length > 0) {
            const mats = await pool.query("SELECT product_id, quantity FROM service_materials WHERE service_id = $1", [svc.rows[0].id]);
            for (const m of mats.rows) {
                await pool.query("UPDATE products SET stock = GREATEST(stock - ($1 * $2), 0) WHERE id = $3", [m.quantity, item.quantity, m.product_id]);
            }
        }
    }

    await pool.query(`UPDATE orders SET voided = FALSE, void_reason = NULL, voided_by = NULL, voided_at = NULL WHERE id = $1`, [id]);
    return { success: true };
}

async function archiveOrder(id) { await pool.query("UPDATE orders SET archived_at = NOW() WHERE id = $1", [id]); }
async function restoreOrder(id) { await pool.query("UPDATE orders SET archived_at = NULL WHERE id = $1", [id]); }
async function archiveBatch(ids) { if (!ids || ids.length === 0) return 0; await pool.query("UPDATE orders SET archived_at = NOW() WHERE id = ANY($1::int[])", [ids]); return ids.length; }
async function cleanupOldArchive() { const result = await pool.query("DELETE FROM orders WHERE archived_at IS NOT NULL AND archived_at < NOW() - INTERVAL '7 days' RETURNING id"); return result.rowCount; }
async function markAsPaid(id) { await pool.query("UPDATE orders SET payment_status = 'Paid' WHERE id = $1", [id]); }
async function markAsUnpaid(id) { await pool.query("UPDATE orders SET payment_status = 'Pending' WHERE id = $1", [id]); }

async function deleteOrder(id) {
    const orderResult = await pool.query("SELECT id, date, customer, total, payment_status, COALESCE(status, 'Received') AS status, cashier_name FROM orders WHERE id = $1", [id]);
    if (orderResult.rows.length === 0) return;
    const order = orderResult.rows[0];
    const archivedResult = await pool.query(`INSERT INTO archived_orders (original_id, date, customer, total, payment_status, status, cashier_name) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [order.id, order.date, order.customer, order.total, order.payment_status, order.status, order.cashier_name]);
    const archivedId = archivedResult.rows[0].id;
    const items = await pool.query("SELECT service_name, quantity, price FROM order_items WHERE order_id = $1", [id]);
    for (const item of items.rows) {
        await pool.query("INSERT INTO archived_order_items (archived_order_id, service_name, quantity, price) VALUES ($1, $2, $3, $4)", [archivedId, item.service_name, item.quantity, item.price]);
    }
    await pool.query("DELETE FROM order_items WHERE order_id = $1", [id]);
    await pool.query("DELETE FROM orders WHERE id = $1", [id]);
}

async function updateOrderStatus(id, status, step = null, history = null, riderName = null) {
    await pool.query(`UPDATE orders SET status = $1, current_step = COALESCE($2, current_step), status_history = COALESCE($3, status_history), rider_name = COALESCE($4, rider_name), status_updated_at = NOW() WHERE id = $5`,
        [status, step, history, riderName, id]);
}

// ===== CUSTOMERS =====
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
    const result = await pool.query("INSERT INTO customers (name, phone, address, notes) VALUES ($1, $2, $3, $4) RETURNING id", [name, phone || null, address || null, notes || null]);
    return result.rows[0].id;
}
async function updateCustomer(id, name, phone, address, notes) { await pool.query("UPDATE customers SET name = $1, phone = $2, address = $3, notes = $4 WHERE id = $5", [name, phone || null, address || null, notes || null, id]); }
async function deleteCustomer(id) { await pool.query("DELETE FROM customers WHERE id = $1", [id]); }
async function getCustomerOrders(name) { const result = await pool.query("SELECT id, date, customer, total, payment_status FROM orders WHERE customer = $1 AND voided = FALSE ORDER BY id DESC LIMIT 50", [name]); return result.rows; }

// ===== REPORTS =====
async function getReportSummary(dateFrom, dateTo) {
    const result = await pool.query(`
        SELECT COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS total_revenue, COALESCE(AVG(total), 0) AS avg_order_value,
            COALESCE(SUM(CASE WHEN payment_status = 'Pending' THEN total ELSE 0 END), 0) AS unpaid_revenue
        FROM (
            SELECT total, payment_status FROM orders WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz AND voided = FALSE
            UNION ALL
            SELECT total, payment_status FROM archived_orders WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz
        ) combined`, [dateFrom, dateTo + ' 23:59:59']);
    return result.rows[0];
}

async function getReportDaily(dateFrom, dateTo) {
    const result = await pool.query(`
        SELECT DATE(date::timestamptz) AS day, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS revenue, COALESCE(AVG(total), 0) AS avg_order
        FROM (
            SELECT date, total FROM orders WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz AND voided = FALSE
            UNION ALL
            SELECT date, total FROM archived_orders WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz
        ) combined GROUP BY DATE(date::timestamptz) ORDER BY day ASC`, [dateFrom, dateTo + ' 23:59:59']);
    return result.rows;
}

async function getReportTopServices(dateFrom, dateTo) {
    const result = await pool.query(`
        SELECT service_name, SUM(quantity) AS total_qty, SUM(quantity * price) AS total_revenue
        FROM (
            SELECT oi.service_name, oi.quantity, oi.price FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.date::timestamptz >= $1::timestamptz AND o.date::timestamptz <= $2::timestamptz AND o.voided = FALSE
            UNION ALL
            SELECT aoi.service_name, aoi.quantity, aoi.price FROM archived_order_items aoi JOIN archived_orders ao ON ao.id = aoi.archived_order_id WHERE ao.date::timestamptz >= $1::timestamptz AND ao.date::timestamptz <= $2::timestamptz
        ) combined GROUP BY service_name ORDER BY total_revenue DESC LIMIT 10`, [dateFrom, dateTo + ' 23:59:59']);
    return result.rows;
}

async function getReportTopCustomers(dateFrom, dateTo) {
    const result = await pool.query(`
        SELECT customer, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS total_spent
        FROM (
            SELECT customer, total FROM orders WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz AND voided = FALSE
            UNION ALL
            SELECT customer, total FROM archived_orders WHERE date::timestamptz >= $1::timestamptz AND date::timestamptz <= $2::timestamptz
        ) combined GROUP BY customer ORDER BY total_spent DESC LIMIT 10`, [dateFrom, dateTo + ' 23:59:59']);
    return result.rows;
}

// ===== SETTINGS =====
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

// ===== CASHIERS =====
async function getCashiers() { const result = await pool.query("SELECT id, name, active, created_at FROM cashiers ORDER BY id ASC"); return result.rows; }
async function addCashier(name, pin) { const result = await pool.query("INSERT INTO cashiers (name, pin) VALUES ($1, $2) RETURNING id", [name, pin]); return result.rows[0].id; }
async function updateCashierPin(id, newPin) { await pool.query("UPDATE cashiers SET pin = $1 WHERE id = $2", [newPin, id]); }
async function deleteCashier(id) { await pool.query("DELETE FROM cashiers WHERE id = $1", [id]); }
async function findCashierByPin(pin) { const result = await pool.query("SELECT id, name FROM cashiers WHERE pin = $1 AND active = TRUE", [pin]); return result.rows[0]; }

// ===== PRODUCTS =====
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
async function replenishProduct(id, quantity, cost, notes, supplier, category) {
    await pool.query("INSERT INTO replenishments (product_id, quantity, cost, notes, supplier, category) VALUES ($1, $2, $3, $4, $5, $6)", [id, quantity, cost, notes || '', supplier || '', category || 'Supplies']);
    await pool.query("UPDATE products SET stock = stock + $1 WHERE id = $2", [quantity, id]);
}
async function getReplenishments() {
    const result = await pool.query(`SELECT r.id, r.quantity, r.cost, r.date, r.notes, r.supplier, r.category, p.name AS product_name, p.icon AS product_icon, p.image_data AS product_image FROM replenishments r JOIN products p ON p.id = r.product_id ORDER BY r.id DESC LIMIT 200`);
    return result.rows;
}
async function getReplenishmentCategories() { const result = await pool.query("SELECT DISTINCT category FROM replenishments WHERE category IS NOT NULL AND category != '' ORDER BY category"); return result.rows.map(r => r.category); }
async function getLowStockProducts() { const result = await pool.query("SELECT id, name, stock, low_limit FROM products WHERE stock <= low_limit"); return result.rows; }

// ===== EXPENSES =====
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
    const query = `SELECT 'expense-' || e.id AS unique_id, e.id AS ref_id, e.date, COALESCE(e.description, e.category) AS description, e.si_or_number, COALESCE(e.account, 'Operating Expense') AS account, 'Manual' AS source, e.amount, e.category, e.supplier, e.notes FROM expenses e ${whereClause} ORDER BY date DESC LIMIT 500`;
    const result = await pool.query(query, params);
    return result.rows;
}

async function getLedgerStats(dateFrom, dateTo) {
    const params = [];
    const conditions = [];
    if (dateFrom) { params.push(dateFrom); conditions.push(`date::timestamptz >= $${params.length}::timestamptz`); }
    if (dateTo) { params.push(dateTo + ' 23:59:59'); conditions.push(`date::timestamptz <= $${params.length}::timestamptz`); }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await pool.query(`SELECT SUM(amount) AS total, COUNT(*) AS count, MAX(amount) AS highest FROM expenses ${whereClause}`, params);
    const row = result.rows[0];
    const total = parseFloat(row.total) || 0;
    const count = parseInt(row.count) || 0;
    return { total, count, highest: parseFloat(row.highest) || 0, average: count > 0 ? total / count : 0 };
}

// ===== ASSETS =====
async function getAssets() { const result = await pool.query("SELECT * FROM assets WHERE status != 'Retired' ORDER BY purchase_date DESC, id DESC"); return result.rows; }
async function addAsset(data) {
    const result = await pool.query(`INSERT INTO assets (name, category, purchase_price, purchase_date, useful_life_months, salvage_value, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [data.name, data.category || 'Equipment', parseFloat(data.purchase_price) || 0, data.purchase_date || new Date().toISOString().split('T')[0], parseInt(data.useful_life_months) || 60, parseFloat(data.salvage_value) || 0, data.notes || '']);
    return result.rows[0];
}
async function updateAsset(id, data) {
    await pool.query(`UPDATE assets SET name = $1, category = $2, purchase_price = $3, purchase_date = $4, useful_life_months = $5, salvage_value = $6, notes = $7 WHERE id = $8`,
        [data.name, data.category || 'Equipment', parseFloat(data.purchase_price) || 0, data.purchase_date, parseInt(data.useful_life_months) || 60, parseFloat(data.salvage_value) || 0, data.notes || '', id]);
}
async function deleteAsset(id) { await pool.query("DELETE FROM assets WHERE id = $1", [id]); }

// ===== CAPITAL =====
async function getCapital() { const result = await pool.query("SELECT * FROM capital_investments ORDER BY date DESC, id DESC"); return result.rows; }
async function addCapital(data) {
    const result = await pool.query(`INSERT INTO capital_investments (description, amount, category, date, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [data.description, parseFloat(data.amount) || 0, data.category || 'Startup', data.date || new Date().toISOString().split('T')[0], data.notes || '']);
    return result.rows[0];
}
async function updateCapital(id, data) {
    await pool.query(`UPDATE capital_investments SET description = $1, amount = $2, category = $3, date = $4, notes = $5 WHERE id = $6`,
        [data.description, parseFloat(data.amount) || 0, data.category || 'Startup', data.date, data.notes || '', id]);
}
async function deleteCapital(id) { await pool.query("DELETE FROM capital_investments WHERE id = $1", [id]); }

// ===== ROI =====
async function getROIData() {
    const capitalRes = await pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM capital_investments");
    const totalCapital = parseFloat(capitalRes.rows[0].total) || 0;
    const assetsRes = await pool.query("SELECT * FROM assets WHERE status = 'Active'");
    const assets = assetsRes.rows;
    let totalAssets = 0;
    let monthlyDepreciation = 0;
    const now = new Date();
    for (const a of assets) {
        const price = parseFloat(a.purchase_price) || 0;
        const salvage = parseFloat(a.salvage_value) || 0;
        const lifeMonths = parseInt(a.useful_life_months) || 60;
        totalAssets += price;
        const monthsOwned = Math.floor((now - new Date(a.purchase_date)) / (30 * 24 * 60 * 60 * 1000));
        const totalDepreciation = Math.max(0, price - salvage);
        const monthlyDep = totalDepreciation / lifeMonths;
        if (monthsOwned < lifeMonths) monthlyDepreciation += monthlyDep;
    }
    const revRes = await pool.query(`SELECT COALESCE(SUM(total), 0) AS total FROM orders WHERE archived_at IS NULL AND voided = FALSE`);
    const totalRevenue = parseFloat(revRes.rows[0].total) || 0;
    const expRes = await pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM expenses");
    const totalExpenses = parseFloat(expRes.rows[0].total) || 0;
    const repRes = await pool.query("SELECT COALESCE(SUM(cost * quantity), 0) AS total FROM replenishments");
    const totalReplenish = parseFloat(repRes.rows[0].total) || 0;
    const totalInvestment = totalCapital + totalAssets;
    let totalDepreciationToDate = 0;
    for (const a of assets) {
        const price = parseFloat(a.purchase_price) || 0;
        const salvage = parseFloat(a.salvage_value) || 0;
        const lifeMonths = parseInt(a.useful_life_months) || 60;
        const monthsOwned = Math.floor((now - new Date(a.purchase_date)) / (30 * 24 * 60 * 60 * 1000));
        const totalDep = Math.max(0, price - salvage);
        const monthsToCount = Math.min(monthsOwned, lifeMonths);
        totalDepreciationToDate += (totalDep / lifeMonths) * monthsToCount;
    }
    const netProfit = totalRevenue - totalExpenses - totalReplenish - totalDepreciationToDate;
    const roi = totalInvestment > 0 ? (netProfit / totalInvestment) * 100 : 0;
    const monthsActive = await pool.query(`SELECT EXTRACT(EPOCH FROM (NOW() - MIN(date::timestamptz)))/2629800 AS months FROM orders WHERE voided = FALSE`);
    const activeMonths = Math.max(1, parseFloat(monthsActive.rows[0].months) || 1);
    const avgMonthlyProfit = netProfit / activeMonths;
    const paybackMonths = avgMonthlyProfit > 0 ? totalInvestment / avgMonthlyProfit : 0;
    return { totalCapital, totalAssets, totalInvestment, monthlyDepreciation, totalDepreciationToDate, totalRevenue, totalExpenses: totalExpenses + totalReplenish, netProfit, roi, paybackMonths, activeMonths, assetCount: assets.length, paybackRecovered: netProfit >= totalInvestment };
}

// ===== BOOKINGS =====
async function getBookings(filter) {
    let conditions = [];
    const params = [];
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 24*60*60*1000).toISOString().split('T')[0];
    if (filter === 'today') { conditions.push(`preferred_date = $${params.length + 1}`); params.push(today); }
    else if (filter === 'tomorrow') { conditions.push(`preferred_date = $${params.length + 1}`); params.push(tomorrow); }
    else if (filter === 'pending') { conditions.push(`status = 'Pending'`); }
    else if (filter === 'upcoming') { conditions.push(`preferred_date >= $${params.length + 1} AND status = 'Pending'`); params.push(today); }
    let query = "SELECT * FROM bookings";
    if (conditions.length > 0) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY preferred_date ASC, preferred_time ASC, id DESC LIMIT 500";
    const result = await pool.query(query, params);
    return result.rows;
}

async function addBooking(data) {
    const result = await pool.query(`INSERT INTO bookings (customer_name, customer_phone, customer_address, service_type, preferred_date, preferred_time, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [data.customer_name, data.customer_phone, data.customer_address, data.service_type || '', data.preferred_date, data.preferred_time, data.notes || '']);
    return result.rows[0];
}

async function updateBookingStatus(id, status) { await pool.query("UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2", [status, id]); }
async function deleteBooking(id) { await pool.query("DELETE FROM bookings WHERE id = $1", [id]); }
async function getBookingById(id) { const result = await pool.query("SELECT * FROM bookings WHERE id = $1", [id]); return result.rows[0]; }

// ===== USERS =====
async function getUserByUsername(username) { const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]); return result.rows[0]; }
async function getUserByEmail(email) { const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]); return result.rows[0]; }
async function getUserById(id) { const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]); return result.rows[0]; }
async function getAllUsers() { const result = await pool.query("SELECT id, username, email, full_name, role, created_at, last_login FROM users ORDER BY id ASC"); return result.rows; }
async function getUserCount() { const result = await pool.query("SELECT COUNT(*) AS count FROM users"); return parseInt(result.rows[0].count); }
async function createUser(data) {
    const result = await pool.query(`INSERT INTO users (username, password_hash, email, full_name, role, security_question, security_answer_hash) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [data.username, data.password_hash, data.email || null, data.full_name || null, data.role || 'admin', data.security_question || null, data.security_answer_hash || null]);
    return result.rows[0].id;
}
async function updateUserPassword(id, password_hash) { await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [password_hash, id]); }
async function updateLastLogin(id) { await pool.query("UPDATE users SET last_login = NOW() WHERE id = $1", [id]); }
async function setResetToken(id, token, expires) { await pool.query("UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3", [token, expires, id]); }
async function getUserByResetToken(token) { const result = await pool.query("SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()", [token]); return result.rows[0]; }
async function clearResetToken(id) { await pool.query("UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE id = $1", [id]); }
async function deleteUser(id) { await pool.query("DELETE FROM users WHERE id = $1", [id]); }
async function updateUserRole(id, role) { await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, id]); }

module.exports = {
    pool, getServices, addService, updateService, deleteService, getPickupService,
    getAllServiceFlows, addServiceFlow, updateServiceFlow, deleteServiceFlow, getServiceFlowByKey,
    saveOrder, getOrders, getArchivedOrders, getOrderById, archiveOrder, restoreOrder, archiveBatch, cleanupOldArchive,
    markAsPaid, markAsUnpaid, deleteOrder, updateOrderStatus,
    voidOrder, unvoidOrder,
    getCustomers, getCustomer, addCustomer, updateCustomer, deleteCustomer, getCustomerOrders,
    getReportSummary, getReportDaily, getReportTopServices, getReportTopCustomers,
    getAllSettings, updateSettings,
    getCashiers, addCashier, updateCashierPin, deleteCashier, findCashierByPin,
    getProducts, getProductCategories, addProduct, updateProduct, deleteProduct,
    replenishProduct, getReplenishments, getReplenishmentCategories, getLowStockProducts,
    getExpenses, getExpenseCategories, addExpense, updateExpense, deleteExpense,
    getUnifiedLedger, getLedgerStats,
    getAssets, addAsset, updateAsset, deleteAsset,
    getCapital, addCapital, updateCapital, deleteCapital,
    getROIData,
    getBookings, addBooking, updateBookingStatus, deleteBooking, getBookingById,
    getUserByUsername, getUserByEmail, getUserById, getAllUsers, getUserCount,
    createUser, updateUserPassword, updateLastLogin, setResetToken, getUserByResetToken, clearResetToken, deleteUser, updateUserRole,
    logAudit, getAuditLogs, getAuditStats, getFinancialAuditSummary, getCashOnHand,
    getIncomeStatement, getBalanceSheet, getCashFlowStatement,
    getLiabilities, addLiability, updateLiability, deleteLiability, payLiability,
    getOwnerWithdrawals, addOwnerWithdrawal, deleteOwnerWithdrawal
};