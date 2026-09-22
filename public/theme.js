(function() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    document.addEventListener('DOMContentLoaded', function() {
        updateToggleButtons();
        document.querySelectorAll('.theme-toggle').forEach(btn => {
            btn.addEventListener('click', function(e) {
                e.preventDefault();
                toggleTheme();
            });
        });
    });

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        if (next === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        localStorage.setItem('theme', next);
        updateToggleButtons();
    }

    function updateToggleButtons() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        document.querySelectorAll('.theme-toggle').forEach(btn => {
            btn.innerHTML = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
        });
    }
})();