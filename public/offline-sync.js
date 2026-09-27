// ============================================================
// OFFLINE SYNC MODULE
// ============================================================

(function() {
    const SYNC_KEY = 'hawi_offline_orders';
    const MAX_QUEUE = 500;

    function getQueue() {
        try {
            const data = localStorage.getItem(SYNC_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    function saveQueue(queue) {
        try {
            localStorage.setItem(SYNC_KEY, JSON.stringify(queue));
            return true;
        } catch (e) {
            console.error('Cannot save queue:', e);
            return false;
        }
    }

    function addToQueue(order) {
        const queue = getQueue();
        if (queue.length >= MAX_QUEUE) {
            alert('⚠️ Offline queue is full. Please connect to internet to sync.');
            return false;
        }
        order._offlineId = 'offline_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        order._queuedAt = new Date().toISOString();
        order._syncAttempts = 0;
        queue.push(order);
        saveQueue(queue);
        updateBanner();
        return true;
    }

    function removeFromQueue(offlineId) {
        const queue = getQueue().filter(o => o._offlineId !== offlineId);
        saveQueue(queue);
        updateBanner();
    }

    function clearQueue() {
        localStorage.removeItem(SYNC_KEY);
        updateBanner();
    }

    async function syncQueue() {
        if (!navigator.onLine) return { synced: 0, failed: 0 };
        const queue = getQueue();
        if (queue.length === 0) return { synced: 0, failed: 0 };

        const authToken = localStorage.getItem('authToken');
        if (!authToken) return { synced: 0, failed: queue.length };

        let synced = 0;
        let failed = 0;
        const remainingQueue = [];

        for (const order of queue) {
            try {
                const res = await fetch('/api/checkout', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-token': authToken
                    },
                    body: JSON.stringify({
                        customer: order.customer,
                        total: order.total,
                        cartItems: order.cartItems,
                        paymentStatus: order.paymentStatus,
                        cashierName: order.cashierName,
                        pickupDelivery: order.pickupDelivery,
                        customerPhone: order.customerPhone,
                        offlineId: order._offlineId
                    })
                });
                const data = await res.json();
                if (data.error) {
                    order._syncAttempts = (order._syncAttempts || 0) + 1;
                    order._lastError = data.error;
                    if (order._syncAttempts < 3) remainingQueue.push(order);
                    failed++;
                } else {
                    synced++;
                }
            } catch (err) {
                order._syncAttempts = (order._syncAttempts || 0) + 1;
                if (order._syncAttempts < 3) remainingQueue.push(order);
                failed++;
            }
        }

        saveQueue(remainingQueue);
        updateBanner();

        if (synced > 0) {
            window.dispatchEvent(new CustomEvent('ordersSynced', { detail: { synced, failed } }));
        }

        return { synced, failed };
    }

    function isOnline() {
        return navigator.onLine;
    }

    function getBannerEl() {
        let banner = document.getElementById('offlineBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'offlineBanner';
            banner.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 99999;
                padding: 10px 16px;
                color: white;
                font-weight: 700;
                font-size: 13px;
                text-align: center;
                display: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                font-family: 'Segoe UI', sans-serif;
            `;
            document.body.appendChild(banner);
        }
        return banner;
    }

    function updateBanner() {
        const banner = getBannerEl();
        const queue = getQueue();
        const online = isOnline();

        if (online && queue.length === 0) {
            banner.style.display = 'none';
            return;
        }

        banner.style.display = 'block';

        if (!online && queue.length > 0) {
            banner.style.background = '#dc2626';
            banner.innerHTML = `🔴 OFFLINE — ${queue.length} order${queue.length > 1 ? 's' : ''} pending sync. Will auto-sync when online.`;
        } else if (!online) {
            banner.style.background = '#dc2626';
            banner.innerHTML = `🔴 OFFLINE — You can still take orders. They will sync automatically.`;
        } else if (queue.length > 0) {
            banner.style.background = '#f59e0b';
            banner.innerHTML = `🟡 ${queue.length} order${queue.length > 1 ? 's' : ''} pending sync. <button onclick="window.HawiSync.syncNow()" style="background:white; color:#92400e; border:none; padding:4px 12px; border-radius:6px; font-weight:700; cursor:pointer; margin-left:8px;">Sync Now</button>`;
        }
    }

    window.addEventListener('online', () => {
        console.log('[Offline Sync] Back online');
        updateBanner();
        setTimeout(() => {
            syncQueue().then(result => {
                if (result.synced > 0) {
                    showToast(`✅ ${result.synced} order${result.synced > 1 ? 's' : ''} synced to server`);
                }
            });
        }, 2000);
    });

    window.addEventListener('offline', () => {
        console.log('[Offline Sync] Went offline');
        updateBanner();
    });

    setInterval(updateBanner, 5000);

    function showToast(message, duration = 4000) {
        let toast = document.getElementById('hawiToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'hawiToast';
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: #10b981;
                color: white;
                padding: 12px 24px;
                border-radius: 10px;
                font-weight: 700;
                font-size: 14px;
                z-index: 99999;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                font-family: 'Segoe UI', sans-serif;
                opacity: 0;
                transition: opacity 0.3s;
                max-width: 90%;
                text-align: center;
            `;
            document.body.appendChild(toast);
        }
        toast.innerText = message;
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.opacity = '0'; }, duration);
    }

    window.HawiSync = {
        addToQueue,
        removeFromQueue,
        clearQueue,
        syncQueue,
        getQueue,
        getQueueCount: () => getQueue().length,
        isOnline,
        syncNow: async function() {
            const result = await syncQueue();
            if (result.synced > 0) showToast(`✅ ${result.synced} order${result.synced > 1 ? 's' : ''} synced`);
            if (result.failed > 0) showToast(`⚠️ ${result.failed} order${result.failed > 1 ? 's' : ''} failed to sync`, 6000);
            return result;
        },
        showToast
    };

    document.addEventListener('DOMContentLoaded', () => {
        updateBanner();
        if (isOnline() && getQueue().length > 0) {
            setTimeout(syncQueue, 3000);
        }
    });

    console.log('[Offline Sync] Module loaded');
})();