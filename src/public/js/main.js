// Main JavaScript for Bluesky Follower Tracker

document.addEventListener('DOMContentLoaded', () => {
  // Get references to key DOM elements
  const importProgressContainer = document.getElementById('import-progress-container');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressText = document.getElementById('progress-text');
  const importedCountEl = document.getElementById('imported-count');

  // Section toggle functionality
  const sectionHeaders = document.querySelectorAll('.section-header');
  
  sectionHeaders.forEach(header => {
    header.addEventListener('click', function() {
      // Find the corresponding content section
      const contentSection = this.nextElementSibling;
      
      // Toggle the visibility of the content section
      if (contentSection.style.display === 'none' || contentSection.style.display === '') {
        contentSection.style.display = 'block';
      } else {
        contentSection.style.display = 'none';
      }
    });
  });

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
  function updateSortingUrl(column) {
    // Get current URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const currentSortBy = urlParams.get('sortBy');
    const currentSortOrder = urlParams.get('sortOrder');

    // Update sort parameters
    if (currentSortBy === column) {
      // Toggle sort order if clicking the same column
      urlParams.set('sortOrder', currentSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to ascending order
      urlParams.set('sortBy', column);
      urlParams.set('sortOrder', 'asc');
    }

    // Preserve the current page if it exists
    if (!urlParams.has('page')) {
      urlParams.set('page', '1');
    }

    // Redirect to the new URL
    window.location.href = `/?${urlParams.toString()}`;
  }

  // Add click handlers to sortable columns
  const sortableHeaders = document.querySelectorAll('th.sortable');
  sortableHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const column = header.dataset.column;
      updateSortingUrl(column);
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
  window.applyFilters = function(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const urlParams = new URLSearchParams(window.location.search);

    // Preserve sort parameters if they exist
    const sortBy = urlParams.get('sortBy');
    const sortOrder = urlParams.get('sortOrder');

    // Create new URL parameters
    const newParams = new URLSearchParams();
    
    // Add non-empty filter values
    for (const [key, value] of formData.entries()) {
      if (value) {
        newParams.append(key, value.toString());
      }
    }

    // Add back sort parameters if they exist
    if (sortBy) newParams.set('sortBy', sortBy);
    if (sortOrder) newParams.set('sortOrder', sortOrder);

    // Reset to page 1 when applying filters
    newParams.set('page', '1');

    // Redirect with all parameters
    window.location.href = `/?${newParams.toString()}`;
  };

  // Unfollow functionality
  window.unfollowUser = function(did) {
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
  };
});
