import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { QRCodeSVG } from 'qrcode.react'

interface BarcodeDisplayProps {
  value: string
  format: string
  width?: number
  height?: number
}

const FORMAT_MAP: Record<string, string> = {
  code128: 'CODE128',
  ean13: 'EAN13',
  code39: 'CODE39',
}

export function BarcodeDisplay({ value, format, width, height }: BarcodeDisplayProps) {
  if (format === 'qr') {
    return (
      <div className="flex justify-center">
        <QRCodeSVG value={value} size={width ?? 200} bgColor="transparent" fgColor="currentColor" />
      </div>
    )
  }

  return <LinearBarcode value={value} format={format} width={width} height={height} />
}

function LinearBarcode({ value, format, height }: BarcodeDisplayProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current) return
    try {
      JsBarcode(svgRef.current, value, {
        format: FORMAT_MAP[format] ?? 'CODE128',
        displayValue: true,
        width: 2,
        height: height ?? 80,
        margin: 0,
        background: 'transparent',
        lineColor: 'currentColor',
        fontSize: 14,
        font: 'Outfit',
      })
    } catch {
      // Invalid barcode value for format — show fallback
      if (svgRef.current) svgRef.current.innerHTML = ''
    }
  }, [value, format, height])

  return (
    <div className="flex justify-center w-full overflow-hidden">
      <svg ref={svgRef} className="w-full max-w-full" />
    </div>
  )
}
