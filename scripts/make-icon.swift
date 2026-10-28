import AppKit

// Draws the companion's app icon: swift scripts/make-icon.swift OUT.png
let size = 1024.0
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
let context = NSGraphicsContext.current!.cgContext
let tile = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 184, yRadius: 184)
tile.addClip()
NSGradient(colors: [NSColor(red: 0.20, green: 0.16, blue: 0.42, alpha: 1), NSColor(red: 0.07, green: 0.07, blue: 0.16, alpha: 1)])!.draw(in: tile.bounds, angle: -60)
// Broadcast rings around a presence dot.
context.setStrokeColor(NSColor(white: 1, alpha: 0.9).cgColor)
context.setLineCap(.round)
for (radius, alpha, width) in [(150.0, 0.95, 52.0), (255.0, 0.6, 46.0), (360.0, 0.3, 40.0)] {
    context.setStrokeColor(NSColor(white: 1, alpha: alpha).cgColor)
    context.setLineWidth(width)
    context.addArc(center: CGPoint(x: 512, y: 512), radius: radius, startAngle: -.pi * 0.28, endAngle: .pi * 0.28, clockwise: false)
    context.strokePath()
    context.addArc(center: CGPoint(x: 512, y: 512), radius: radius, startAngle: .pi * 0.72, endAngle: .pi * 1.28, clockwise: false)
    context.strokePath()
}
context.setFillColor(NSColor(red: 0.30, green: 0.85, blue: 0.55, alpha: 1).cgColor)
context.fillEllipse(in: CGRect(x: 512 - 78, y: 512 - 78, width: 156, height: 156))
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
