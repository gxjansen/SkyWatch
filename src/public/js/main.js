// Socket.io initialization
let socket;
try {
    socket = io();
} catch (e) {
    console.error('Failed to initialize socket.io:', e);
    // Provide fallback functionality
    socket = {
        on: () => {},
        emit: () => {}
    };
}

// DOM Elements
const importedCountEl = document.getElementById('imported-count');
const importProgressContainer = document.getElementById('import-progress-container');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressText = document.getElementById('progress-text');
const followersTable = document.querySelector('.card:last-child table'); // Target specifically the followers table

// Section collapse/expand functionality
function initializeCollapsibleSection(headerId, contentId, storageKey) {
    const header = document.getElementById(headerId);
    const content = document.getElementById(contentId);
    
    if (!header || !content) return; // Guard against missing elements
    
    // Load saved state
    const isExpanded = localStorage.getItem(storageKey) !== 'collapsed';
    if (isExpanded) {
        header.classList.add('expanded');
        content.classList.add('expanded');
    }

    header.addEventListener('click', () => {
        const isExpanded = header.classList.toggle('expanded');
        content.classList.toggle('expanded');
        
        // Save state
        localStorage.setItem(storageKey, isExpanded ? 'expanded' : 'collapsed');
    });
}

// Initialize collapsible sections
document.addEventListener('DOMContentLoaded', () => {
    initializeCollapsibleSection('columnControlsHeader', 'columnControlsContent', 'columnControlsState');
    initializeCollapsibleSection('filterHeader', 'filterContent', 'filterState');
    loadColumnPreferences();
});

// Column visibility management
const columnToggles = document.querySelectorAll('.column-toggle');

// Load saved column visibility preferences
function loadColumnPreferences() {
    const savedPreferences = localStorage.getItem('columnVisibility');
    if (savedPreferences) {
        try {
            const preferences = JSON.parse(savedPreferences);
            columnToggles.forEach(toggle => {
                const column = toggle.id.replace('col-', '');
                toggle.checked = preferences[column] !== false;
                updateColumnVisibility(column, toggle.checked);
            });
        } catch (e) {
            console.error('Failed to load column preferences:', e);
        }
    }
}

// Save column visibility preferences
function saveColumnPreferences() {
    const preferences = {};
    columnToggles.forEach(toggle => {
        const column = toggle.id.replace('col-', '');
        preferences[column] = toggle.checked;
    });
    try {
        localStorage.setItem('columnVisibility', JSON.stringify(preferences));
    } catch (e) {
        console.error('Failed to save column preferences:', e);
    }
}

// Update column visibility
function updateColumnVisibility(column, visible) {
    // Update cells in the followers table
    const cells = followersTable.querySelectorAll(`[data-column="${column}"]`);
    cells.forEach(cell => {
        cell.style.display = visible ? '' : 'none';
    });
}

// Handle column toggle changes
columnToggles.forEach(toggle => {
    toggle.addEventListener('change', () => {
        const column = toggle.id.replace('col-', '');
        updateColumnVisibility(column, toggle.checked);
        saveColumnPreferences();
    });
});

// Sorting functionality
let currentSort = { column: null, direction: 'asc' };

function sortTable(column) {
    const tbody = followersTable.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const headers = followersTable.querySelectorAll('th.sortable');

    // Update sort direction
    if (currentSort.column === column) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.column = column;
        currentSort.direction = 'asc';
    }

    // Update header classes
    headers.forEach(header => {
        header.classList.remove('asc', 'desc');
        if (header.dataset.column === column) {
            header.classList.add(currentSort.direction);
        }
    });

    // Sort rows
    rows.sort((a, b) => {
        const aCell = a.querySelector(`[data-column="${column}"]`);
        const bCell = b.querySelector(`[data-column="${column}"]`);
        let aValue = aCell.textContent.trim();
        let bValue = bCell.textContent.trim();

        // Handle different data types
        if (column === 'joined' || column === 'lastPost') {
            // Date comparison
            aValue = aValue === 'N/A' ? -Infinity : new Date(aValue);
            bValue = bValue === 'N/A' ? -Infinity : new Date(bValue);
        } else if (['followers', 'following', 'posts'].includes(column)) {
            // Number comparison
            aValue = parseInt(aValue) || 0;
            bValue = parseInt(bValue) || 0;
        } else if (['postsPerDay', 'followerRatio'].includes(column)) {
            // Float comparison
            aValue = aValue === 'N/A' ? -Infinity : parseFloat(aValue);
            bValue = bValue === 'N/A' ? -Infinity : parseFloat(bValue);
        }

        // Compare values
        if (aValue < bValue) return currentSort.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    // Reorder table rows
    rows.forEach(row => tbody.appendChild(row));
}

// Add click handlers to sortable columns
followersTable.querySelectorAll('th.sortable').forEach(header => {
    header.addEventListener('click', () => {
        sortTable(header.dataset.column);
    });
});

// Import progress functionality
let importProgressInterval;

function checkImportProgress() {
    fetch('/import-progress')
    .then(response => response.json())
    .then(data => {
        if (data.isImporting) {
            importProgressContainer.style.display = 'block';
        }
        
        const progressPercentage = data.total > 0 
            ? Math.min(Math.round((data.total / 500) * 100), 100)
            : 0;
        
        progressBarFill.style.width = `${progressPercentage}%`;
        progressText.textContent = `Importing: ${data.total} accounts`;

        if (!data.isImporting) {
            clearInterval(importProgressInterval);
            importedCountEl.textContent = `Total Imported Users: ${data.total}`;
            importProgressContainer.style.display = 'none';
        }
    })
    .catch(error => {
        console.error('Error checking import progress:', error);
    });
}

// Start progress tracking on page load
document.addEventListener('DOMContentLoaded', () => {
    importProgressInterval = setInterval(checkImportProgress, 5000);
});

// Filter form submission
function applyFilters(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const queryParams = new URLSearchParams();

    // Add non-empty filter values to query params
    for (const [key, value] of formData.entries()) {
        if (value) {
            queryParams.append(key, value.toString());
        }
    }

    // Redirect with filter parameters
    window.location.href = `/?${queryParams.toString()}`;
}

// Unfollow functionality
function unfollowUser(did) {
    if (!confirm('Are you sure you want to unfollow this user?')) {
        return;
    }

    fetch('/unfollow', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ did })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Remove the row from the table
            const row = document.querySelector(`button[onclick="unfollowUser('${did}')"]`).closest('tr');
            row.remove();
            // Update the total count
            const currentTotal = parseInt(importedCountEl.textContent.match(/\d+/)[0]);
            importedCountEl.textContent = `Total Imported Users: ${currentTotal - 1}`;
        } else {
            alert('Failed to unfollow user: ' + data.message);
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while unfollowing');
    });
}
