const backendUrl = 'https://script.google.com/macros/s/AKfycbw5rkLx-fcP-FjL1b3DIBV_LstAH4THS8Jpaq9FGxfqfd5cyBppdVwYG7o49HsYDIhkMg/exec';

const NG_POLLING_INTERVAL = 6000;
const FILE_SPECS = {
    'door':          { exact: null, min: [512, 1024], max: [1024, 2048], ratio: 0.5, max_mb: 10 },
    'met-icon':      { exact: [100, 100], max_mb: 1 },
    'award-icon':    { exact: [100, 100], max_mb: 1 },
    'sprite-sheet':  { exact: [128, 64], max_mb: 1 },
};

let currentNgUser = null;
let currentSessionId = null;
let ngPollingInterval = null;

async function apiRequest(action, payload = {}) {
    const response = await fetch(backendUrl, {
        method: 'POST',
        mode: 'cors', 
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload })
    });
    return await response.json();
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function checkImageDimensions(file, spec) {
    const bitmap = await createImageBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    bitmap.close();
    
    if (spec.exact) {
        if (w !== spec.exact[0] || h !== spec.exact[1])
            return `must be exactly ${spec.exact[0]}x${spec.exact[1]} (yours is ${w}x${h})`;
    } else {
        if (spec.min && (w < spec.min[0] || h < spec.min[1]))
            return `must be at least ${spec.min[0]}x${spec.min[1]} (yours is ${w}x${h})`;
        if (spec.max && (w > spec.max[0] || h > spec.max[1]))
            return `must be at most ${spec.max[0]}x${spec.max[1]} (yours is ${w}x${h})`;
        if (spec.ratio && Math.abs((w / h) - spec.ratio) > 0.01)
            return `must have a ${spec.ratio} ratio (yours is ${w}x${h})`;
        if (spec.max_mb && file.size > spec.max_mb * 1024 * 1024) 
            return `file size must not exceed ${spec.max_mb} MB! (yours is ${file.size})`;
    }
    return null;
}

async function processSingleFile(id) {
    const input = document.getElementById(id);
    const file = input.files[0];

    if (!file) throw new Error(`Missing file: ${id}`);

    if (FILE_SPECS[id]) {
        const errorMsg = await checkImageDimensions(file, FILE_SPECS[id]);
        if (errorMsg) throw new Error(`Error in "${id}": ${errorMsg}`);
    }

    const base64 = await readFileAsBase64(file);
    return { fileData: base64, fileName: file.name, fileMimeType: file.type };
}

async function loginWithNewgrounds() {
    const statusEl = document.getElementById('login-status');
    statusEl.textContent = 'Contacting server...';

    document.getElementById('ng-login-btn').disabled = true

    try {
        const data = await apiRequest('ng_start');
        if (data.error) throw new Error(data.error);
        currentSessionId = data.sessionId;
        window.open(data.passportUrl, '_blank', 'width=600,height=500');
        statusEl.textContent = 'Waiting for you to log in on Newgrounds...';

        ngPollingInterval = setInterval(async () => {
            try {
                const status = await apiRequest('ng_check', { sessionId: data.sessionId });
                
                if (status.status === 'logged_in') {
                    clearInterval(ngPollingInterval);
                    currentNgUser = status.user;
                    statusEl.textContent = `Logged in as ${currentNgUser.name}!`;
                    document.getElementById('ng-login-btn').style.display = 'none';
                    document.getElementById('step-2').classList.remove('hidden');
                } else if (status.status === 'error') {
                    clearInterval(ngPollingInterval);
                    statusEl.textContent = `Error: ${status.message || 'Session failed.'} Please refresh and try again.`;
                }
            } catch (err) {
                clearInterval(ngPollingInterval);
                statusEl.textContent = 'Network error while checking login status.';
                console.error(err);
                document.getElementById('ng-login-btn').disabled = false
            }
        }, NG_POLLING_INTERVAL);
    } catch (err) {
        statusEl.textContent = 'Login failed. Please try again.';
        console.error(err);
        document.getElementById('ng-login-btn').disabled = false
    }
}

async function submitApplication() {
    const statusEl = document.getElementById('status');
    const submitBtn = document.getElementById('submit-btn');
    
    submitBtn.disabled = true;
    if (document.getElementById('website').value) return;

    if (!currentNgUser) {
        statusEl.textContent = 'Please log in with Newgrounds first.';
        submitBtn.disabled = false;
        return;
    }


    const inputIds = [
        'door', 'idle', 'success', 'fail', 
        'met-icon', 'award-icon', 'sprite-sheet'
    ];

    const filesData = {};

    try {
        statusEl.textContent = 'Validating and processing images...';
        for (const id of inputIds) {
            filesData[id] = await processSingleFile(id);
        }
        const selectedHousing = document.querySelector('input[name="housing-pref"]:checked').value;
        statusEl.textContent = 'Uploading application...';
        const payload = {
            sessionId: currentSessionId,
            files: filesData,
            housingPreference: selectedHousing
        };

        const result = await apiRequest('submit_application', payload);
        
        if (result.status === 'success') {
            statusEl.textContent = 'Application sent successfully!';
            document.getElementById('application-form').style.display = 'none';
        } else {
            statusEl.textContent = `Server error: ${result.message}`;
            submitBtn.disabled = false;
        }

    } catch (err) {
        statusEl.textContent = err.message;
        submitBtn.disabled = false;
    }
}

document.getElementById('ng-login-btn').addEventListener('click', loginWithNewgrounds);
document.getElementById('submit-btn').addEventListener('click', submitApplication);

document.querySelectorAll('input[type="file"]').forEach(input => {
  const preview = input.closest('label').querySelector('img.preview');
  let currentUrl = null;

  input.addEventListener('change', () => {
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }

    const file = input.files[0];
    if (!file) {
      preview.hidden = true;
      preview.removeAttribute('src');
      return;
    }

    currentUrl = URL.createObjectURL(file);
    preview.src = currentUrl;
    preview.hidden = false;

    document.getElementById('step-3').classList.remove('hidden');
  });
});

const deadlineString = "2026-12-18T23:59:59-05:00";
const deadlineTime = new Date(deadlineString).getTime();
const countdownEl = document.getElementById('countdown');

const timerInterval = setInterval(() => {
    const now = new Date().getTime();
    const distance = deadlineTime - now;

    if (distance < 0) {
        clearInterval(timerInterval);
        countdownEl.textContent = "DEADLINE PASSED - APPLICATIONS CLOSED";
        countdownEl.style.color = "#000";
        
        document.getElementById('ng-login-btn').disabled = true;
        document.getElementById('submit-btn').disabled = true;
        document.getElementById('step-1').classList.add('hidden');
        document.getElementById('step-2').classList.add('hidden');
        document.getElementById('step-3').classList.add('hidden');
        return;
    }

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    countdownEl.textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
}, 1000);
