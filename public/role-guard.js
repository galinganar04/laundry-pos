// ============================================
// ROLE-BASED ACCESS CONTROL
// Include this BEFORE /theme.js in every page EXCEPT login, signup, forgot, reset
// ============================================

(function() {
    const role = localStorage.getItem('userRole');
    const token = localStorage.getItem('authToken');
    const path = window.location.pathname;

    // Public pages — no check
    const publicPages = ['/login.html', '/signup.html', '/forgot.html', '/reset.html'];
    if (publicPages.includes(path)) return;

    // Not logged in → login
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    // Pages a cashier CAN access
    const cashierAllowed = ['/', '/index.html', '', '/orders.html'];

    // Cashier restrictions
    if (role === 'cashier') {
        if (!cashierAllowed.includes(path)) {
            window.location.href = '/';
            return;
        }
    }

    // Hide restricted sidebar links for cashiers
    document.addEventListener('DOMContentLoaded', function() {
        if (role === 'cashier') {
            const restricted = ['/dashboard.html', '/services.html', '/products.html', '/replenishments.html', '/expenses.html', '/customers.html', '/settings.html'];
            document.querySelectorAll('.sidebar a').forEach(a => {
                const href = a.getAttribute('href');
                if (href && restricted.includes(href)) {
                    a.style.display = 'none';
                }
            });
        }
    });
})();