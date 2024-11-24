// Main JavaScript for Bluesky Follower Tracker

document.addEventListener('DOMContentLoaded', () => {
  // Get references to key DOM elements
  const followersTable = document.querySelector('.table-container table');
  const importProgressContainer = document.getElementById('import-progress-container');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressText = document.getElementById('progress-text');
  const importedCountEl = document.getElementById('imported-count');

  // Column Toggle Functionality
  const columnToggles = document.querySelectorAll('.column-toggle');
  
  columnToggles.forEach(toggle => {
    toggle.addEventListener('change', function() {
      // Extract the column name from the checkbox ID
      const columnName = this.id.replace('col-', '');
      
      // Select all cells in this column across all tables
      const columnCells = document.querySelectorAll(`
        [data-column="${columnName}"]
      `);
      
      // Toggle visibility based on checkbox state
      columnCells.forEach(cell => {
        cell.style.display = this.checked ? '' : 'none';
      });
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
});
