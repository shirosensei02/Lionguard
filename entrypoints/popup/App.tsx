import { Toggle, Setting, Card } from '@/components';
import { Trash } from 'lucide-react';
import { useState, useEffect } from 'react';

type Page = 'home' | 'details' | 'allowlist' | 'settings';

function App() {
  const iconSize = 35;
  const iconSizeSmall = 25;

  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [tempList, setTempList] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState<string>('');
  const [flaggedCount, setFlaggedCount] = useState<number>(0);

  // --- Page navigation handlers ---
  const footerDetailsOnClick = () => setCurrentPage('details');
  const footerAllowlistOnClick = () => setCurrentPage('allowlist');
  const handleSettingsClick = () => setCurrentPage('settings');
  const handleBackToHome = () => setCurrentPage('home');

  // --- Fetch allowlist, temp list, flagged count ---
  useEffect(() => {
    const updateAllowlist = () => {
      chrome.runtime.sendMessage({ action: "get-allowlist" }, (response) => {
        if (response && Array.isArray(response)) setAllowlist(response);
      });
    };
    updateAllowlist();

    chrome.runtime.sendMessage({ action: "get-temp-allowlist" }, (response) => {
      if (response && Array.isArray(response)) setTempList(response);
    });

    chrome.runtime.sendMessage({ action: "get-flagged-count" }, (response) => {
      if (typeof response === "number") setFlaggedCount(response);
    });

    // --- Live update listener for flagged sites ---
    const handleMessage = (message: any) => {
      if (message.action === "update-flagged-count" && typeof message.count === "number") {
        setFlaggedCount(message.count);
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);

    // --- Listen for permanent allowlist storage changes ---
    const handleStorageChange = (changes: any, areaName: string) => {
      if (areaName === "local" && changes.allowlist) {
        setAllowlist(changes.allowlist.newValue || []);
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // --- Add URL to permanent allowlist ---
  const handleAddUrl = () => {
    if (!newUrl) return;
    const fullUrl = /^https?:\/\//i.test(newUrl) ? newUrl : "https://" + newUrl;

    chrome.runtime.sendMessage({ action: "allowlist", url: fullUrl }, (response) => {
      if (response && Array.isArray(response)) {
        setAllowlist(response);
        setNewUrl('');
      }
    });
  };

  // --- Remove URL from permanent allowlist ---
  const handleRemoveUrl = (url: string) => {
    const fullUrl = /^https?:\/\//i.test(url) ? url : "https://" + url;
    chrome.runtime.sendMessage({ action: "remove-url", url: fullUrl }, (response) => {
      if (response && Array.isArray(response)) setAllowlist(response);
    });
  };

  // --- Remove URL from temporary allowlist ---
  const handleRemoveTemp = (url: string) => {
    chrome.runtime.sendMessage({ action: "remove-temp-url", url }, (resp) => {
      if (resp?.ok) {
        const host = /^https?:\/\//i.test(url) ? new URL(url).hostname : url;
        setTempList(prev => prev.filter(u => u !== host));
      }
    });
  };

  // --- Render Settings Page ---
  if (currentPage === 'settings') {
    return (
      <>
        <div className='header'>
          <h1 className='title'>
            <span className='title-red'>Lion</span>
            <span className='title-black'>Guard</span>
          </h1>
          <div className='header-right'>
            <button onClick={handleBackToHome} className='back-button'>Back</button>
          </div>
        </div>

        <div className='settings'>
          <h2 className='settings-title'>Settings</h2>
          <div className='settings-content'>
            <div className="settings-pii">
              <p>PII Detection</p>
              <Toggle size={iconSize} />
            </div>
            <div className="settings-url">
              <p>URL Reputation Check</p>
              <Toggle size={iconSize} />
            </div>
          </div>
        </div>

        <div className='footer'>
          <button className='footer-export'>Export</button>
          <button className='footer-uninstall'>Uninstall</button>
        </div>
      </>
    );
  }

  // --- Render Details Page ---
  if (currentPage === 'details') {
    return (
      <div>
        <div className='header'>
          <button onClick={handleBackToHome} className='back-button'>← Back</button>
          <h1 className='title'><span className='title-red'>Details</span></h1>
        </div>
        <div className='body'>
          <h2>Detailed Information</h2>
          <p>Here are the details about flagged sites...</p>
          {/* Add your details content here */}
        </div>
      </div>
    );
  }

  // --- Render Allowlist Page ---
  if (currentPage === 'allowlist') {
    return (
      <div style={{ minWidth: '400px', minHeight: '500px', overflowY: 'auto', padding: '1rem' }}>
        <div className='header'>
          <button onClick={handleBackToHome} className='back-button'>← Back</button>
          <h1 className='title'><span className='title-red'>Allowlist</span></h1>
        </div>

        <div className='body'>
          <h2>Manage Allowlist</h2>

          {/* Add new URL */}
          <div className='allowlist-input' style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type='text'
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder='Enter site URL'
              style={{ flex: 1 }}
            />
            <button onClick={handleAddUrl}>Add</button>
          </div>

          {/* Permanent Allowlist */}
          <h3>Permanent</h3>
          <ul className='allowlist-list' style={{ paddingLeft: 0 }}>
            {allowlist.map((url, index) => (
              <li key={index} className='allowlist-item' style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <span style={{ wordBreak: 'break-all', flex: 1 }}>{url}</span>
                <button className='allowlist-item-button' onClick={() => handleRemoveUrl(url)}>
                  <Trash size={iconSizeSmall} />
                </button>
              </li>
            ))}
          </ul>

          {/* Temporary Allowlist */}
          <h3>Temporary</h3>
          <ul className='allowlist-list' style={{ paddingLeft: 0 }}>
            {tempList.map((url) => (
              <li key={url} className='allowlist-item' style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <span style={{ wordBreak: 'break-all', flex: 1 }}>{url}</span>
                <button className='allowlist-item-button' onClick={() => handleRemoveTemp(url)}>
                  <Trash size={iconSizeSmall} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // --- Render Home Page ---
  return (
    <>
      <div className='header'>
        <h1 className='title'>
          <span className='title-red'>Lion</span>
          <span className='title-black'>Guard</span>
        </h1>
        <div className='header-right'>
          <Setting size={iconSize} onClick={handleSettingsClick} />
          <Toggle size={iconSize} />
        </div>
      </div>

      <div className='body'>
        <Card title="Sites flagged" count={flaggedCount.toString()} />
        <Card title="PII warning" count="3" />
        <Card title="Breach check" count="0" />
      </div>

      <div className='footer'>
        <button className='footer-details-button' onClick={footerDetailsOnClick}>View Details</button>
        <button className='footer-allowlist-button' onClick={footerAllowlistOnClick}>Allowlist</button>
      </div>
    </>
  );
}

export default App;
