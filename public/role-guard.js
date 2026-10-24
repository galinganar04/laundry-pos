// ============================================
// ROLE-BASED ACCESS CONTROL
// ============================================

(function() {
    const role = localStorage.getItem('userRole');
    const token = localStorage.getItem('authToken');
    const path = window.location.pathname;

    // Public pages — no check
    const publicPages = ['/login.html', '/signup.html', '/forgot.html', '/reset.html', '/book.html', '/track.html'];
    if (publicPages.includes(path)) return;

    // Not logged in → login
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    // Pages a cashier CAN access
    const cashierAllowed = [
        '/',
        '/index.html',
        '',
        '/orders.html',
        '/bookings.html'
    ];

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
            const restricted = [
                '/dashboard.html',
                '/audit.html',
                '/services.html',
                '/products.html',
                '/replenishments.html',
                '/expenses.html',
                '/statements.html',
                '/liabilities.html',
                '/withdrawals.html',
                '/capital.html',
                '/assets.html',
                '/settings.html'
            ];
            document.querySelectorAll('.sidebar a').forEach(a => {
                const href = a.getAttribute('href');
                if (href && restricted.includes(href)) {
                    a.style.display = 'none';
                }
            });
        }
    });
})();