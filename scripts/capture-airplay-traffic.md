# AirPlay Traffic Capture Guide

To reverse-engineer how Reflector (or other working AirPlay receivers) handle the protocol, you can capture network traffic and compare it with your implementation.

## Method 1: Using Wireshark

1. **Install Wireshark** (if not already installed)
   ```bash
   brew install wireshark  # macOS
   ```

2. **Start Wireshark** and capture traffic on your network interface (usually `en0` or `en1` on macOS)

3. **Filter for AirPlay traffic**:
   ```
   tcp.port == 7000 || tcp.port == 7001 || tcp.port == 7002 || mdns
   ```

4. **Connect your iPhone** to Reflector (or another working AirPlay receiver)

5. **Analyze the packets**:
   - Look for HTTP requests to `/info` or `/server-info`
   - Check the request headers and body (binary PLIST)
   - Check the response headers and body
   - Compare the response structure with what your server sends

## Method 2: Using tcpdump (Command Line)

```bash
# Capture traffic on port 7000-7005
sudo tcpdump -i en0 -w airplay-capture.pcap 'tcp portrange 7000-7005'

# Then analyze with Wireshark
open airplay-capture.pcap
```

## Method 3: Using Node.js HTTP Proxy (Built-in)

We can add a proxy mode to your AirPlay server that logs all traffic for comparison.

## What to Look For

1. **Request structure**: What does iPhone send to `/info`?
2. **Response structure**: What does Reflector send back?
3. **Headers**: Are there any headers we're missing?
4. **Binary PLIST format**: Compare the exact binary PLIST structure
5. **Follow-up requests**: What happens after `/info` succeeds?

## Key Differences to Check

- Response field names (case sensitivity?)
- Field types (strings vs numbers)
- Field order in binary PLIST
- Additional fields we might be missing
- HTTP status codes
- Response headers
