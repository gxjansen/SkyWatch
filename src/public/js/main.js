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

// Profile update functionality
async function updateProfileData(retryDelay = 5000) {
    try {
        const response = await fetch('/api/profile');
        
        if (response.status === 429) {
            // Handle rate limit
            const data = await response.json();
            const retryAfter = (data.retryAfter || 300) * 1000; // Convert to milliseconds
            console.log(`Rate limited, will retry after ${retryAfter/1000} seconds`);
            setTimeout(() => updateProfileData(Math.min(retryAfter * 2, 30000)), retryAfter);
            return;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const profile = await response.json();
        
        // Update profile data in the table
        const mainUserRow = document.querySelector('.main-user-stats tbody tr');
        if (mainUserRow) {
            // Update avatar if it exists
            const avatarCell = mainUserRow.querySelector('[data-column="avatar"]');
            if (avatarCell && profile.avatar) {
                avatarCell.innerHTML = `<img src="${profile.avatar}" alt="Your avatar" class="avatar">`;
            }
            
            // Update handle with link
            const handleCell = mainUserRow.querySelector('[data-column="handle"]');
            if (handleCell) {
                handleCell.innerHTML = `<a href="https://bsky.app/profile/${profile.handle}" target="_blank" rel="noopener noreferrer" class="profile-link">${profile.handle}</a>`;
            }
            
            // Update numeric values
            const cells = {
                followers: profile.followerCount,
                following: profile.followingCount,
                posts: profile.postCount,
                postsPerDay: profile.postsPerDay.toFixed(1),
                followerRatio: profile.followerRatio.toFixed(1),
                joined: new Date(profile.joinedAt).toISOString().split('T')[0]
            };

            Object.entries(cells).forEach(([key, value]) => {
                const cell = mainUserRow.querySelector(`[data-column="${key}"]`);
                if (cell) {
                    cell.textContent = value;
                }
            });
        }

        // Schedule next update after success (5 minutes)
        setTimeout(() => updateProfileData(), 5 * 60 * 1000);
    } catch (error) {
        console.error('Error updating profile data:', error);
        // Retry with exponential backoff
        setTimeout(() => updateProfileData(Math.min(retryDelay * 2, 30000)), retryDelay);
    }
}

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

// Initialize collapsible sections and start profile updates
document.addEventListener('DOMContentLoaded', () => {
    initializeCollapsibleSection('columnControlsHeader', 'columnControlsContent', 'columnControlsState');
    initializeCollapsibleSection('filterHeader', 'filterContent', 'filterState');
    loadColumnPreferences();
    
    // Start profile updates immediately
    updateProfileData();
    
    // Start progress tracking
    importProgressInterval = setInterval(checkImportProgress, 5000);
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
    // Update cells in both tables (main user and followers)
    document.querySelectorAll(`[data-column="${column}"]`).forEach(cell => {
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
        importedCountEl.textContent = `Total Imported Users: ${data.total}`;

        if (!data.isImporting) {
            clearInterval(importProgressInterval);
            importProgressContainer.style.display = 'none';
        }
    })
    .catch(error => {
        console.error('Error checking import progress:', error);
    });
}

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
