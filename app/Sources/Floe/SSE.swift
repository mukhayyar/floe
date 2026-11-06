import Foundation

struct SSEEvent {
    let event: String
    let data: String
}

let streamSession: URLSession = {
    let c = URLSessionConfiguration.default
    c.timeoutIntervalForRequest = 600
    c.timeoutIntervalForResource = .infinity
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    return URLSession(configuration: c)
}()

/// Server-sent events. Our proxy always sends single-line JSON in `data:`, so each data
/// line is one event (AsyncLineSequence drops the blank separator lines).
func sseStream(_ request: URLRequest) -> AsyncThrowingStream<SSEEvent, Error> {
    AsyncThrowingStream { cont in
        let task = Task {
            do {
                let (bytes, response) = try await streamSession.bytes(for: request)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                    throw URLError(.badServerResponse)
                }
                var event = "message"
                for try await line in bytes.lines {
                    if line.hasPrefix("event:") {
                        event = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                    } else if line.hasPrefix("data:") {
                        cont.yield(SSEEvent(event: event, data: String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)))
                        event = "message"
                    }
                }
                cont.finish()
            } catch {
                cont.finish(throwing: error)
            }
        }
        cont.onTermination = { _ in task.cancel() }
    }
}
