// ============================================================
// LIVE BOOKING BADGE — Pending only
// Works for ALL users (owner, admin, cashier)
// Shows badge in sidebar AND mobile topbar
// ============================================================

(function() {
    const authToken = localStorage.getItem('authToken');
    const userRole = localStorage.getItem('userRole');
    if (!authToken) return;

    function updateBookingBadge() {
        const sidebarLinks = document.querySelectorAll('a[href="/bookings.html"]');
        const mobileBadge = document.getElementById('mobileBookingBadge');
        if (sidebarLinks.length === 0 && !mobileBadge) return;

        fetch('/api/bookings?filter=pending', { headers: { 'x-auth-token': authToken } })
            .then(res => {
                if (res.status === 401) return;
                return res.json();
            })
            .then(bookings => {
                if (!Array.isArray(bookings)) return;
                const count = bookings.length;

                // Update sidebar links
                sidebarLinks.forEach(link => {
                    const existing = link.querySelector('.booking-badge');
                    if (existing) existing.remove();

                    if (count > 0) {
                        link.style.display = 'flex';
                        link.style.alignItems = 'center';
                        link.style.justifyContent = 'space-between';

                        const badge = document.createElement('span');
                        badge.className = 'booking-badge';
                        badge.textContent = count;
                        badge.style.cssText = `
                            background: #10b981;
                            color: white;
                            font-size: 11px;
                            font-weight: 800;
                            padding: 2px 8px;
                            border-radius: 10px;
                            margin-left: 8px;
                            animation: pulse-badge 1.5s infinite;
                            box-shadow: 0 0 0 0 rgba(16,185,129,0.7);
                            min-width: 22px;
                            text-align: center;
                        `;
                        link.appendChild(badge);
                    }
                });

                // Update mobile topbar badge
                if (mobileBadge) {
                    if (count > 0) {
                        mobileBadge.textContent = count > 99 ? '99+' : count;
                        mobileBadge.style.display = 'flex';
                    } else {
                        mobileBadge.style.display = 'none';
                    }
                }
            })
            .catch(() => {});
    }

    if (!document.getElementById('booking-badge-style')) {
        const style = document.createElement('style');
        style.id = 'booking-badge-style';
        style.textContent = `
            @keyframes pulse-badge {
                0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.7); }
                70% { box-shadow: 0 0 0 6px rgba(16,185,129,0); }
                100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); }
            }
        `;
        document.head.appendChild(style);
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(updateBookingBadge, 500);
    });

    setInterval(updateBookingBadge, 30000);

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) updateBookingBadge();
    });
})();