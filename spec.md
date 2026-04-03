# YAC - Version 32: Real Camera Vision

## Current State

The app has a `CameraHudPanel` component that shows a live camera feed via a `<video>` element in a floating HUD panel. A "INITIATE VISUAL SCAN" button exists but it only sends a generic text prompt (`"Describe what you see in my camera feed right now..."`) to the AI -- it does NOT actually capture or send any image data. The AI has no real visual input, so it cannot truly see anything.

The AI backend uses Pollinations.ai (`text.pollinations.ai`) for text queries. The POST endpoint (`/openai`) supports the OpenAI messages format.

## Requested Changes (Diff)

### Add
- A hidden `<canvas>` element co-located with the camera video, used to capture frames
- A `captureFrameAsBase64()` utility function that draws the current video frame to canvas and returns a base64 JPEG data URL
- A `callVisionAI(imageBase64, question)` function that calls the Pollinations `/openai` endpoint with the image as a base64 data URL in a vision-format message (role: user, content: [{type:"image_url", ...}, {type:"text", ...}]). Use model `openai` (GPT-4o supports vision). Fallback to `gpt-oss` if first fails.
- Auto-scan mode: when camera is ON, automatically scan every 8 seconds and describe what is seen in the chat (only if something meaningful is detected -- skip if the description is very similar to the last one)
- A visible "scanning" indicator animation in the camera panel while a vision scan is in progress
- The SCAN button should now actually capture a real frame and send it to the vision AI
- After a scan, YAC should speak the result aloud using the existing voice synthesis

### Modify
- `handleCameraScanBound`: instead of just calling `sendMessage("Describe what you...")`, it should capture a real frame with canvas, call the vision AI endpoint with the image, display the result in chat, and speak it
- `CameraHudPanel` component: accept a `canvasRef` prop and render a hidden canvas element; add a `scanning` boolean prop to show a scanning animation/indicator
- The camera panel should show a green "SCANNING" flash animation during vision AI processing
- Camera panel should show an "AUTO-SCAN: ON" indicator when auto-scan is active (camera is on)

### Remove
- The old behavior of sending a text-only description request when SCAN is tapped

## Implementation Plan

1. Add `canvasRef = useRef<HTMLCanvasElement>(null)` to the main component alongside `videoRef`
2. Add `captureFrameAsBase64()` function: draw video to canvas (320x240 for efficiency), return `canvas.toDataURL('image/jpeg', 0.7)`
3. Add `callVisionAI(imageBase64: string, question: string): Promise<string>` function that POSTs to `https://text.pollinations.ai/openai` with model `openai`, messages formatted with image_url content type. Include YAC system prompt. Fallback to `gpt-oss`. 10s timeout.
4. Add `[scanning, setScanning]` state boolean
5. Replace `handleCameraScanBound` with a real function: capture frame → call vision AI → add assistant message to chat → speak result
6. Add `useEffect` for auto-scan: when `cameraOn === true`, set an interval of 8000ms. Each tick: capture frame, call vision AI with "Briefly describe what you see in 1-2 sentences.", add to chat, speak if meaningful. Clear interval on `cameraOn === false` or unmount.
7. Pass `canvasRef`, `scanning` to `CameraHudPanel`; render `<canvas ref={canvasRef} style={{display:'none'}} />` inside the panel
8. Add scanning indicator: when `scanning` is true, show a pulsing amber border or overlay on the video with "SCANNING..." text
9. Show "AUTO ● LIVE" indicator badge in the camera panel header when camera is on
