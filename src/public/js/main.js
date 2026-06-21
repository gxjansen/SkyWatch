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
  let refreshActive = false;

  function checkImportProgress() {
    fetch('/import-progress')
    .then(response => response.json())
    .then(data => {
      if (!data.isImporting) {
        clearInterval(importProgressInterval);
        importProgressContainer.style.display = 'none';
        // After a user-triggered refresh, reload to show updated rows/counts.
        if (refreshActive) {
          refreshActive = false;
          window.location.reload();
        }
        return;
      }

      importProgressContainer.style.display = 'block';

      // Use the live follow count as the target when available.
      const target = data.target && data.target > 0 ? data.target : data.total;
      const progressPercentage = target > 0
        ? Math.min(Math.round((data.total / target) * 100), 100)
        : 0;

      progressBarFill.style.width = `${progressPercentage}%`;
      progressText.textContent = `Refreshing: ${data.total}${target ? ' / ' + target : ''} accounts`;
      importedCountEl.textContent = `Total Imported Users: ${data.total}`;
    })
    .catch(error => {
      console.error('Error checking import progress:', error);
    });
  }

  // Refresh followers: triggers an incremental import (add new + prune removed).
  window.refreshFollowers = function() {
    const btn = document.getElementById('refresh-button');
    if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }

    fetch('/import', { method: 'POST' })
    .then(response => response.json())
    .then(data => {
      if (!data.success) {
        alert('Could not start refresh: ' + (data.message || 'unknown error'));
        if (btn) { btn.disabled = false; btn.textContent = 'Refresh followers'; }
        return;
      }
      refreshActive = true;
      importProgressContainer.style.display = 'block';
      progressText.textContent = 'Refreshing…';
      if (importProgressInterval) clearInterval(importProgressInterval);
      importProgressInterval = setInterval(checkImportProgress, 2000);
    })
    .catch(error => {
      console.error('Error starting refresh:', error);
      alert('An error occurred while starting the refresh');
      if (btn) { btn.disabled = false; btn.textContent = 'Refresh followers'; }
    });
  };

  // If an import is already running when the page loads, show live progress.
  checkImportProgress();

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

  // Bulk selection + unfollow
  const selectAll = document.getElementById('select-all');
  const bulkBar = document.getElementById('bulk-bar');
  const selectedCountEl = document.getElementById('selected-count');

  function getRowCheckboxes() {
    return Array.from(document.querySelectorAll('.row-select'));
  }

  function updateBulkBar() {
    if (!bulkBar) return;
    const boxes = getRowCheckboxes();
    const checked = boxes.filter(cb => cb.checked);
    if (selectedCountEl) selectedCountEl.textContent = `${checked.length} selected`;
    bulkBar.style.display = checked.length > 0 ? 'flex' : 'none';
    if (selectAll) {
      selectAll.checked = boxes.length > 0 && checked.length === boxes.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < boxes.length;
    }
  }

  if (selectAll) {
    selectAll.addEventListener('change', () => {
      getRowCheckboxes().forEach(cb => { cb.checked = selectAll.checked; });
      updateBulkBar();
    });
  }
  getRowCheckboxes().forEach(cb => cb.addEventListener('change', updateBulkBar));

  window.bulkUnfollow = function() {
    const dids = getRowCheckboxes().filter(cb => cb.checked).map(cb => cb.dataset.did);
    if (dids.length === 0) return;
    if (!confirm(`Unfollow ${dids.length} selected account(s)? This cannot be undone.`)) {
      return;
    }

    const btn = document.querySelector('.bulk-unfollow-button');
    if (btn) { btn.disabled = true; btn.textContent = `Unfollowing ${dids.length}…`; }

    fetch('/unfollow-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dids })
    })
    .then(response => response.json())
    .then(data => {
      const results = data.results || [];
      let succeeded = 0;
      results.forEach(res => {
        if (res.success) {
          succeeded++;
          const cb = document.querySelector(`.row-select[data-did="${res.did}"]`);
          const row = cb && cb.closest('tr');
          if (row) row.remove();
        }
      });

      // Update the total count.
      const m = importedCountEl.textContent.match(/\d+/);
      if (m) {
        importedCountEl.textContent = `Total Imported Users: ${Math.max(0, parseInt(m[0]) - succeeded)}`;
      }

      if (data.failedCount) {
        const firstError = (results.find(r => !r.success) || {}).message || 'unknown error';
        alert(`Unfollowed ${succeeded}. ${data.failedCount} failed (e.g. "${firstError}").`);
      }

      if (btn) { btn.disabled = false; btn.textContent = 'Unfollow selected'; }
      updateBulkBar();
    })
    .catch(error => {
      console.error('Bulk unfollow error:', error);
      alert('An error occurred during bulk unfollow');
      if (btn) { btn.disabled = false; btn.textContent = 'Unfollow selected'; }
    });
  };
});
