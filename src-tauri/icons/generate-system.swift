import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

// swift src-tauri/icons/generate-system.swift src-tauri/icons/icon.png <output directory>
guard CommandLine.arguments.count == 3 else {
    fatalError("Usage: generate-system.swift <transparent PicParty PNG> <output directory>")
}

let source = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
      let mark = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
    fatalError("Unable to decode the PicParty mark")
}

let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: alpha)
}

func canvas(width: Int, height: Int) -> CGContext {
    let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                            bytesPerRow: width * 4, space: colorSpace,
                            bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    return context
}

func write(_ image: CGImage, to url: URL) {
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    precondition(CGImageDestinationFinalize(destination))
}

struct Theme {
    let name: String
    let top: UInt32
    let bottom: UInt32
}

let themes = [Theme(name: "Orange", top: 0xffb349, bottom: 0xf27224),
              Theme(name: "Forest", top: 0x245b48, bottom: 0x0c3126)]

func systemIcon(size: Int, theme: Theme) -> CGImage {
    let ctx = canvas(width: size, height: size)
    let edge = CGFloat(size)
    let background = CGRect(x: edge * 0.058, y: edge * 0.060, width: edge * 0.884, height: edge * 0.884)
    let shape = CGPath(roundedRect: background, cornerWidth: edge * 0.197, cornerHeight: edge * 0.197, transform: nil)
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    let gradient = CGGradient(colorsSpace: colorSpace, colors: [color(theme.top), color(theme.bottom)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(gradient, start: CGPoint(x: edge * 0.29, y: background.maxY),
                           end: CGPoint(x: edge * 0.71, y: background.minY),
                           options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    let width = edge * 0.903
    ctx.setShadow(offset: CGSize(width: 0, height: -edge * 0.018), blur: edge * 0.025,
                  color: color(0x08251c, alpha: 0.28))
    ctx.draw(mark, in: CGRect(x: (edge - width) / 2, y: (edge - width) / 2 + edge * 0.008,
                              width: width, height: width))
    ctx.restoreGState()
    ctx.addPath(shape)
    ctx.setLineWidth(max(0.35, edge * 0.004))
    ctx.setStrokeColor(color(0xffffff, alpha: 0.24))
    ctx.strokePath()
    return ctx.makeImage()!
}

for theme in themes {
    let directory = output.appendingPathComponent("PicParty\(theme.name).iconset", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    for logicalSize in [16, 32, 128, 256, 512] {
        for scale in [1, 2] {
            let suffix = scale == 2 ? "@2x" : ""
            let name = "icon_\(logicalSize)x\(logicalSize)\(suffix).png"
            write(systemIcon(size: logicalSize * scale, theme: theme), to: directory.appendingPathComponent(name))
        }
    }
}

// Compare at the actual pixel sizes on both light and dark surfaces.
let sheet = canvas(width: 588, height: 265)
func label(_ value: String, x: CGFloat, y: CGFloat, size: CGFloat = 13, ink: UInt32 = 0x24342d) {
    let text = NSAttributedString(string: value, attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica Neue" as CFString, size, nil),
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): color(ink)
    ])
    sheet.textPosition = CGPoint(x: x, y: y)
    CTLineDraw(CTLineCreateWithAttributedString(text), sheet)
}

sheet.setFillColor(color(0xf7f7f2))
sheet.fill(CGRect(x: 0, y: 0, width: 588, height: 265))
for column in 0..<3 {
    let x = CGFloat(16 + column * 188)
    label(["Original", "Orange", "Forest"][column], x: x + 7, y: 239, size: 15)
    for (index, dark) in [false, true].enumerated() {
        let y = CGFloat(125 - index * 105)
        sheet.setFillColor(color(dark ? 0x252a28 : 0xffffff))
        sheet.fill(CGRect(x: x, y: y, width: 178, height: 96))
        for (position, size) in [16, 32, 64].enumerated() {
            let center = x + CGFloat([26, 75, 133][position])
            let square = CGRect(x: center - CGFloat(size) / 2, y: y + 51 - CGFloat(size) / 2,
                                width: CGFloat(size), height: CGFloat(size))
            sheet.draw(column == 0 ? mark : systemIcon(size: size, theme: themes[column - 1]), in: square)
            label("\(size)", x: center - 7, y: y + 7, size: 11, ink: dark ? 0xd7e0da : 0x495e53)
        }
    }
}
write(sheet.makeImage()!, to: output.appendingPathComponent("系统图标小尺寸对比.png"))
