/* ===== UNIFIED SIDEBAR RENDERER ===== */
(function() {
    if (!localStorage.getItem('authToken')) return;

    // Detect current page for active state
    const currentPath = window.location.pathname;
    const isActive = (href) => {
        if (href === '/' && (currentPath === '/' || currentPath === '/index.html')) return 'active';
        if (href !== '/' && currentPath === href) return 'active';
        return '';
    };

    const sidebarHTML = `
        <div class="col-md-2 sidebar d-none d-md-block">
            <div class="sidebar-brand">
                <img src="/logo.png" alt="Hawi's Lovada">
            </div>

            <div class="sidebar-section">Main</div>
            <a href="/" class="${isActive('/')}">🧺 POS</a>
            <a href="/dashboard.html" class="${isActive('/dashboard.html')}">📊 Dashboard</a>
            <a href="/orders.html" class="${isActive('/orders.html')}">📋 Orders</a>
            <a href="/bookings.html" class="${isActive('/bookings.html')}">📅 Bookings</a>

            <div class="sidebar-section">Catalog</div>
            <a href="/services.html" class="${isActive('/services.html')}">🧴 Services</a>
            <a href="/products.html" class="${isActive('/products.html')}">📦 Products</a>
            <a href="/replenishments.html" class="${isActive('/replenishments.html')}">📥 Replenishments</a>

            <div class="sidebar-section">Finances</div>
            <a href="/expenses.html" class="${isActive('/expenses.html')}">💸 Expenses</a>
            <a href="/statements.html" class="${isActive('/statements.html')}">📑 Statements</a>
            <a href="/liabilities.html" class="${isActive('/liabilities.html')}">💳 Liabilities</a>
            <a href="/withdrawals.html" class="${isActive('/withdrawals.html')}">💸 Withdrawals</a>
            <a href="/capital.html" class="${isActive('/capital.html')}">💵 Capital</a>
            <a href="/assets.html" class="${isActive('/assets.html')}">🏗️ Assets</a>

            <div class="sidebar-section">System</div>
            <a href="/audit.html" class="${isActive('/audit.html')}">🔍 Audit Trail</a>
            <a href="/settings.html" class="${isActive('/settings.html')}">⚙️ Settings</a>
            <a href="#" class="theme-toggle">🌙 Dark Mode</a>
            <a href="#" onclick="event.preventDefault(); logout();">🚪 Logout</a>
        </div>
    `;

    // Inject into placeholder
    document.addEventListener('DOMContentLoaded', () => {
        const placeholder = document.getElementById('sidebar-placeholder');
        if (placeholder) {
            placeholder.outerHTML = sidebarHTML;
            // Re-init theme toggle for the newly added sidebar
            if (window.updateThemeToggleButtons) window.updateThemeToggleButtons();
        }
    });

    // Logout helper (in case page doesn't define one)
    window.logout = window.logout || function() {
        const token = localStorage.getItem('authToken');
        if (token) fetch('/api/logout', { method: 'POST', headers: { 'x-auth-token': token } });
        localStorage.removeItem('authToken');
        localStorage.removeItem('userName');
        localStorage.removeItem('userRole');
        window.location.href = '/login.html';
    };
})();