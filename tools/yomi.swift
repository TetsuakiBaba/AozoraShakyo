// 文章を語に分け、それぞれの読み（ひらがな）を出す。tools/aozora.py から呼ぶ
//
//     echo '["メロスは激怒した。"]' | swift tools/yomi.swift
//     → [[[0, 3, "めろす"], [3, 1, "は"], ...]]   （位置と長さは UTF-16 で数える）
//
// macOS に入っている日本語の解析（CFStringTokenizer）を使うので、ほかに何も入れなくてよい。

import CoreFoundation
import Foundation

let input = FileHandle.standardInput.readDataToEndOfFile()
let texts = try JSONSerialization.jsonObject(with: input) as! [String]

var result: [[[Any]]] = []
for text in texts {
  let string = text as NSString
  let tokenizer = CFStringTokenizerCreate(
    nil, string, CFRangeMake(0, string.length), kCFStringTokenizerUnitWordBoundary,
    Locale(identifier: "ja") as CFLocale)
  var tokens: [[Any]] = []
  var type = CFStringTokenizerAdvanceToNextToken(tokenizer)
  while type.rawValue != 0 {
    let range = CFStringTokenizerGetCurrentTokenRange(tokenizer)
    if let latin = CFStringTokenizerCopyCurrentTokenAttribute(
      tokenizer, kCFStringTokenizerAttributeLatinTranscription) as? String
    {
      let kana = NSMutableString(string: latin)
      CFStringTransform(kana, nil, kCFStringTransformLatinHiragana, false)
      tokens.append([range.location, range.length, kana as String])
    }
    type = CFStringTokenizerAdvanceToNextToken(tokenizer)
  }
  result.append(tokens)
}

let output = try JSONSerialization.data(withJSONObject: result)
FileHandle.standardOutput.write(output)
