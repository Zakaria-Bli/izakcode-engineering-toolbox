# React Upload UI Boundary

React upload UI is intentionally outside `@toolbox/media-storage` core.

## Decision

Do not place React hooks, components, styling, toast handling, or framework route assumptions in this package's core exports.

The core package provides:

- upload intent workflow
- completion workflow
- storage provider ports
- framework adapters

React UI should live in one of:

- an application-owned feature folder
- a future `@toolbox/media-storage-react` package
- a future toolbox template under `templates/media-upload-react`

## Why

React upload UI depends on application choices:

- route paths
- design system
- drag/drop library
- toast/error UX
- preview behavior
- optimistic form workflow
- single vs multi upload UX
- i18n
- auth/session model

Keeping it separate prevents client bundle pollution and avoids coupling core media workflows to React.

## Suggested client adapter shape

Applications can create a small client adapter that talks to their own endpoints:

```ts
export interface UploadClient {
  init(input: {
    filename: string
    mimeType: string
    size: number
    kind: string
    pathPrefix?: string | null
  }): Promise<{
    uploadUrl: string
    method?: "PUT" | "POST"
    headers: Record<string, string>
    fields?: Record<string, string>
    sessionId: string
    assetId: string | number
  }>

  uploadWithProgress(input: {
    uploadUrl: string
    method?: "PUT" | "POST"
    headers: Record<string, string>
    fields?: Record<string, string>
    file: File
    onProgress?: (progress: number) => void
  }): Promise<void>

  complete(sessionId: string): Promise<unknown>
}
```

Use `XMLHttpRequest` for upload progress because `fetch()` does not expose upload progress in browsers.

Handle both provider upload target styles:

- `PUT` target: send the file as the request body with returned headers.
- `POST` target: send returned fields plus `file` as `multipart/form-data`.

```ts
export function uploadWithProgress({
  uploadUrl,
  method = "PUT",
  headers,
  fields,
  file,
  onProgress,
}: UploadInput) {
  const xhr = new XMLHttpRequest()

  const promise = new Promise<void>((resolve, reject) => {
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress?.((event.loaded / event.total) * 100)
      }
    })

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Upload failed with status ${xhr.status}`))
    })

    xhr.addEventListener("error", () => reject(new Error("Network error")))
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")))

    xhr.open(method, uploadUrl)

    if (method === "POST") {
      const formData = new FormData()
      for (const [name, value] of Object.entries(fields ?? {})) {
        formData.append(name, value)
      }
      formData.append("file", file)
      xhr.send(formData)
      return
    }

    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value)
    }
    xhr.send(file)
  })

  return { xhr, promise }
}
```

## UI template boundary

Upload UI belongs in app or template code. Keep hooks, components, and upload adapters outside `@toolbox/media-storage` core, and have them call application endpoints rather than toolbox internals.
