import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// swift src-tauri/icons/generate.swift <approved transparent PNG> <icons directory>
guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: generate.swift <transparent PNG> <icons directory>")
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let iconset = output.appendingPathComponent("PicParty.iconset", isDirectory: true)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let bitmapInfo = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
func canvas(width: Int, height: Int) -> CGContext {
    let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: width * 4, space: colorSpace, bitmapInfo: bitmapInfo)!
    context.interpolationQuality = .high
    return context
}

guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      image.width <= 8192, image.height <= 8192 else {
    fatalError("Unable to decode the supplied icon")
}

let original = canvas(width: image.width, height: image.height)
original.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
let bytes = original.data!.assumingMemoryBound(to: UInt8.self)
var minX = image.width, minY = image.height, maxX = 0, maxY = 0
for y in 0..<image.height {
    for x in 0..<image.width {
        let index = y * original.bytesPerRow + x * 4
        // Remove nearly invisible alpha specks in the source's transparent margin.
        if bytes[index + 3] < 8 {
            for channel in 0..<4 { bytes[index + channel] = 0 }
            continue
        }
        minX = min(minX, x)
        minY = min(minY, y)
        maxX = max(maxX, x + 1)
        maxY = max(maxY, y + 1)
    }
}
guard minX < maxX, minY < maxY,
      let artwork = original.makeImage()?.cropping(to: CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)) else {
    fatalError("The icon contains no artwork")
}

func writePNG(size: Int, to url: URL) {
    let context = canvas(width: size, height: size)
    let scale = Double(size) * 0.792 / Double(max(artwork.width, artwork.height))
    let width = Double(artwork.width) * scale
    let height = Double(artwork.height) * scale
    context.draw(artwork, in: CGRect(x: (Double(size) - width) / 2, y: (Double(size) - height) / 2,
                                     width: width, height: height))
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    precondition(CGImageDestinationFinalize(destination))
}

for logicalSize in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let suffix = scale == 2 ? "@2x" : ""
        writePNG(size: logicalSize * scale, to: iconset.appendingPathComponent("icon_\(logicalSize)x\(logicalSize)\(suffix).png"))
    }
}
writePNG(size: 1024, to: output.appendingPathComponent("icon.png"))
