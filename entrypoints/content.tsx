import redactText from "./shared/redactApi";
import React from "react";
import ReactDOM from "react-dom/client";
import RedactButton from "./shared/RedactButton";

export default defineContentScript({
  matches: ["*://*/*"],
  main() {
    // Function to process input field values when space or enter is pressed
    const processInputOnKeyPress = async (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;

      // Check if space or enter was pressed first
      if (event.key === " " || event.key === "Enter") {
        let inputValue = "";
        let inputType = "";
        let inputName = "";
        let isValidInput = false;

        // Check traditional input fields and textareas
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          inputValue = target.value;
          inputType = target instanceof HTMLInputElement ? target.type : "textarea";
          inputName = target.name || target.id || target.className || "unnamed";
          isValidInput = true;
        }
        // Check contenteditable elements (used by ChatGPT and many modern web apps)
        else if (target.isContentEditable || target.getAttribute("contenteditable") === "true") {
          inputValue = target.textContent || target.innerText || "";
          inputType = "contenteditable";
          inputName =
            target.id ||
            target.className ||
            target.getAttribute("data-testid") ||
            target.getAttribute("aria-label") ||
            "contenteditable";
          isValidInput = true;
        }
        // Check any element with role="textbox"
        else if (target.getAttribute("role") === "textbox") {
          inputValue = target.textContent || target.innerText || "";
          inputType = "role-textbox";
          inputName =
            target.id || target.className || target.getAttribute("aria-label") || "role-textbox";
          isValidInput = true;
        }

        if (isValidInput && inputValue.trim()) {
          try {
            // Call the redact API with the input value
            const redactResult = await redactText(inputValue);

            console.log("PII Analysis completed:", {
              original: inputValue,
              redacted: redactResult?.redacted_text,
              piiDetected: redactResult?.redacted_text !== inputValue,
              type: inputType,
              name: inputName,
              key: event.key,
              timestamp: new Date().toISOString(),
              url: window.location.href,
              element: target.tagName.toLowerCase(),
              classList: Array.from(target.classList),
            });

            // Automatically replace the content with redacted version if PII is detected
            if (redactResult?.redacted_text && redactResult.redacted_text !== inputValue) {
              if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
                target.value = redactResult.redacted_text;
                target.dispatchEvent(new Event("input", {bubbles: true}));
                target.dispatchEvent(new Event("change", {bubbles: true}));
              } else if (target.isContentEditable) {
                target.textContent = redactResult.redacted_text;
                target.dispatchEvent(new Event("input", {bubbles: true}));
              }
            }
          } catch (error) {
            console.error("Error calling redact API:", error);
          }
        }

        // Check for email breach if input type is email
        if (isValidInput && inputType === "email") {
          try {
            const result = await browser.runtime.sendMessage({
              type: 'checkBreach',
              email: inputValue
            });
            
            console.log("Email breach check result:", result);
            // Handle the breach result here - maybe show a warning UI
            if (result.breaches?.length > 0) {
              // Show warning to user
            }
          } catch (error) {
            console.error("Error checking email breach:", error);
          }
        }
      }
    };

    // Add event listener for keydown events
    document.addEventListener("keydown", processInputOnKeyPress, true);

    // Optional: Also listen for keyup events to catch any missed events
    document.addEventListener("keyup", processInputOnKeyPress, true);

    // Debug: Log all keydown events to see what's happening
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === " " || event.key === "Enter") {
          console.log("Key pressed on element:", {
            key: event.key,
            target: event.target,
            tagName: (event.target as HTMLElement)?.tagName,
            isContentEditable: (event.target as HTMLElement)?.isContentEditable,
            classList: Array.from((event.target as HTMLElement)?.classList || []),
            id: (event.target as HTMLElement)?.id,
            attributes: {
              "data-testid": (event.target as HTMLElement)?.getAttribute("data-testid"),
              "aria-label": (event.target as HTMLElement)?.getAttribute("aria-label"),
              role: (event.target as HTMLElement)?.getAttribute("role"),
              contenteditable: (event.target as HTMLElement)?.getAttribute("contenteditable"),
            },
          });
        }
      },
      true
    );

    //   const INJECTED_ATTR = "data-redact-btn-injected";

    //   // Add necessary CSS for our extension only once
    //   if (!document.querySelector("#pii-redact-extension-styles")) {
    //     const style = document.createElement("style");
    //     style.id = "pii-redact-extension-styles";
    //     style.textContent = `
    //       @keyframes pii-pulse {
    //         0%, 100% { opacity: 1; }
    //         50% { opacity: 0.5; }
    //       }
    //       .pii-redact-button-container {
    //         all: initial;
    //         font-family: system-ui, -apple-system, sans-serif;
    //       }
    //     `;
    //     document.head.appendChild(style);
    //   }

    //   const isEligible = (el: Element): el is HTMLInputElement | HTMLTextAreaElement => {
    //     if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    //     if (el instanceof HTMLInputElement) {
    //       const type = (el.getAttribute("type") || "text").toLowerCase();
    //       // Skip non-textual inputs and sensitive ones like password
    //       const allowed = ["text", "search", "email", "url", "tel", "number"];
    //       if (!allowed.includes(type)) return false;
    //     }
    //     if (el.hasAttribute(INJECTED_ATTR)) return false;
    //     if (el.disabled || el.readOnly) return false;
    //     return true;
    //   };

    //   const buildReactButton = (field: HTMLInputElement | HTMLTextAreaElement) => {
    //     const container = document.createElement("div");
    //     container.style.position = "absolute";
    //     container.style.transform = "translateY(-50%)";
    //     container.style.display = "flex";
    //     container.style.alignItems = "center";
    //     container.style.gap = "4px";
    //     container.style.pointerEvents = "auto";
    //     container.style.zIndex = "2147483647";

    //     // Add a unique class to prevent CSS conflicts
    //     container.className = "pii-redact-button-container";

    //     const onRedact = async () => {
    //       const original = field.value ?? "";
    //       if (!original.trim()) return;
    //       const res = await redactText(original);
    //       if (res?.redacted_text && typeof res.redacted_text === "string") {
    //         const end = field.selectionEnd ?? original.length;
    //         field.value = res.redacted_text;
    //         const pos = Math.min(res.redacted_text.length, end);
    //         try {
    //           field.setSelectionRange(pos, pos);
    //         } catch {}
    //         field.dispatchEvent(new Event("input", {bubbles: true}));
    //         field.dispatchEvent(new Event("change", {bubbles: true}));
    //       }
    //     };

    //     const root = ReactDOM.createRoot(container);
    //     root.render(
    //       <React.StrictMode>
    //         <RedactButton onRedact={onRedact} />
    //       </React.StrictMode>
    //     );
    //     return container;
    //   };

    //   const injectForField = (field: HTMLInputElement | HTMLTextAreaElement) => {
    //     if (!isEligible(field)) return;
    //     field.setAttribute(INJECTED_ATTR, "1");

    //     // Wrap the field with a relatively positioned container
    //     const wrapper = document.createElement("div");
    //     wrapper.style.position = "relative";
    //     wrapper.style.display =
    //       getComputedStyle(field).display === "block" ? "block" : "inline-block";

    //     // Add right padding so text doesn't overlap the button
    //     // const currentPaddingRight = parseFloat(getComputedStyle(field).paddingRight || "0");
    //     // const extra = 74; // space for the button
    //     // field.style.paddingRight = `${currentPaddingRight + extra}px`;

    //     const btnHost = buildReactButton(field);

    //     // Insert wrapper in DOM around the field
    //     const parent = field.parentElement;
    //     if (!parent) return;
    //     parent.insertBefore(wrapper, field);
    //     wrapper.appendChild(field);
    //     wrapper.appendChild(btnHost);
    //   };

    //   const scanAndInject = (root: ParentNode = document) => {
    //     root.querySelectorAll("input, textarea").forEach((el) => {
    //       if (isEligible(el)) injectForField(el as HTMLInputElement | HTMLTextAreaElement);
    //     });
    //   };

    //   // Initial scan
    //   scanAndInject();

    //   // Observe for dynamically added inputs/textareas
    //   const mo = new MutationObserver((mutations) => {
    //     for (const m of mutations) {
    //       if (m.type === "childList") {
    //         m.addedNodes.forEach((n) => {
    //           if (n.nodeType !== Node.ELEMENT_NODE) return;
    //           const el = n as Element;
    //           if (isEligible(el)) {
    //             injectForField(el);
    //           }
    //           el.querySelectorAll?.("input, textarea").forEach((sub) => {
    //             if (isEligible(sub)) injectForField(sub as HTMLInputElement | HTMLTextAreaElement);
    //           });
    //         });
    //       }
    //       if (m.type === "attributes" && m.target instanceof Element) {
    //         const el = m.target;
    //         if (isEligible(el)) injectForField(el as HTMLInputElement | HTMLTextAreaElement);
    //       }
    //     }
    //   });
    //   mo.observe(document.documentElement, {
    //     subtree: true,
    //     childList: true,
    //     attributes: true,
    //     attributeFilter: ["disabled", "readonly", "type"],
    //   });
  },
});
