// ============================================================
// LIVE BOOKING BADGE — Pending only
// Shows green pulsing badge with count of PENDING bookings
// ============================================================

(function() {
    const authToken = localStorage.getItem('authToken');
    if (!authToken) return;

    function updateBookingBadge() {
        const links = document.querySelectorAll('a[href="/bookings.html"]');
        if (links.length === 0) return;

        fetch('/api/bookings?filter=pending', { headers: { 'x-auth-token': authToken } })
            .then(res => {
                if (res.status === 401) return;
                return res.json();
            })
            .then(bookings => {
                if (!Array.isArray(bookings)) return;
                const count = bookings.length;

                links.forEach(link => {
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