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

  const footerDetailsOnClick = () => {
    setCurrentPage('details');
  }

  const footerAllowlistOnClick = () => {
    setCurrentPage('allowlist');
  }

  const handleSettingsClick = () => {
    setCurrentPage('settings');
  }

  const handleBackToHome = () => {
    setCurrentPage('home');
  }
  // Fetch allowlist from background when popup loads
  useEffect(() => {
    chrome.runtime.sendMessage({ action: "get-allowlist" }, (response) => {
      if (response && Array.isArray(response)) setAllowlist(response);
    });
    chrome.runtime.sendMessage({ action: "get-temp-allowlist" }, (response) => {
      if (response && Array.isArray(response)) setTempList(response);
    });
  }, []);

  // Add URL to allowlist
  const handleAddUrl = () => {
    if (!newUrl) return;
    let fullUrl = newUrl;
    if (!/^https?:\/\//i.test(newUrl)) fullUrl = "https://" + newUrl; // Normalize URL

    chrome.runtime.sendMessage({ action: "allowlist", url: fullUrl }, (response) => {
      if (response && Array.isArray(response)) {
        setAllowlist(response);
        setNewUrl("");
      }
    });
  };

  // Remove URL from permanent allowlist
  const handleRemoveUrl = (url: string) => {
    let fullUrl = url;
    if (!/^https?:\/\//i.test(url)) fullUrl = "https://" + url;

    chrome.runtime.sendMessage({ action: "remove-url", url: fullUrl }, (response) => {
      if (response && Array.isArray(response)) setAllowlist(response);
    });
  };

  // Remove URL from temporary allowlist
  const handleRemoveTemp = (url: string) => {
    chrome.runtime.sendMessage({ action: "remove-temp-url", url }, (resp) => {
      if (resp?.ok) setTempList((prev) => prev.filter(u => u !== url));
    });
  };
  // --- Minimal change: add handle for proceeding to temp allowlist ---
  const handleProceedTemp = (url: string) => {
    chrome.runtime.sendMessage({ action: "proceed-temp", url }, (resp) => {
      if (resp?.ok) {
        // Update tempList immediately so the UI shows it
        setTempList((prev) => {
          const host = new URL(url).hostname;
          if (!prev.includes(host)) return [...prev, host];
          return prev;
        });
      }
    });
  };
  // Settings page
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

  // Details page
  if (currentPage === 'details') {
    return (
      <div>
        <div className='header'>
          <button onClick={handleBackToHome} className='back-button'>← Back</button>
          <h1 className='title'>
            <span className='title-red'>Details</span>
          </h1>
        </div>
        <div className='body'>
          <h2>Detailed Information</h2>
          <p>Here are the details about flagged sites...</p>
          {/* Add your details content here */}
        </div>
      </div>
    );
  }

  // --- Allowlist page (permanent + temp) ---
  if (currentPage === 'allowlist') {
    return (
      <div>
        <div className='header'>
          <button onClick={handleBackToHome} className='back-button'>← Back</button>
          <h1 className='title'><span className='title-red'>Allowlist</span></h1>
        </div>
        <div className='body'>
          <h2>Manage Allowlist</h2>

          {/* Add new URL */}
          <div className='allowlist-input'>
            <input
              type='text'
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder='Enter site URL'
            />
            <button onClick={handleAddUrl}>Add</button>
          </div>

          {/* Permanent Allowlist */}
          <h3>Permanent Allowlist</h3>
          <ul className='allowlist-list'>
            {allowlist.map((url, index) => (
              <li key={index} className='allowlist-item'>
                <span>{url}</span>
                <button className='allowlist-item-button' onClick={() => handleRemoveUrl(url)}>
                  <Trash size={iconSizeSmall} />
                </button>
              </li>
            ))}
          </ul>

          {/* Temporary Allowlist */}
          <h3>Temporary Allowlist (Session)</h3>
          <ul className='allowlist-list'>
            {tempList.map((url) => (
              <li key={url} className='allowlist-item'>
                <span>{url}</span>
                <button className='allowlist-item-button' onClick={() => handleRemoveTemp(url)}>
                  <Trash size={iconSizeSmall} />
                </button>
                {/* Example "Proceed Anyway" button to add to temp list */}
                <button onClick={() => handleProceedTemp(url)}>Proceed</button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

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
        <Card title="Sites flagged" count="12" />
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
