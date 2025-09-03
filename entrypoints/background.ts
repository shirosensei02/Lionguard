export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });
});

async function checkEmailForBreach(email: string) {
  try {
    const apiUrl = `https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`;
    
    // Use the browser's built-in fetch API to make the request
    const response = await fetch(apiUrl);

    // If the email is not found, the API returns a 404 status
    if (response.status === 404) {
      const errorData = await response.json();
      if (errorData.Error === "Not found") {
        return { breaches: [], message: 'No breaches found.' };
      }
    }

    if (!response.ok) {
      // Handle other potential errors like server issues
      throw new Error(`API responded with status: ${response.status}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error('Failed to check for breaches:', error);
    // Return an error object so the frontend knows something went wrong
    return { error: 'Failed to fetch breach data.' };
  }
}

(self as any).checkEmailForBreach = checkEmailForBreach;

// Listen for messages from other parts of the extension (like the popup)
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Check if the message is the one we're looking for
  if (message.type === 'checkBreach' && message.email) {
    // Call our async function to perform the check
    checkEmailForBreach(message.email).then(result => {
      // Send the result back to the popup
      sendResponse(result);
    });

    // Return true to indicate that we will send a response asynchronously
    return true; 
  }
});
