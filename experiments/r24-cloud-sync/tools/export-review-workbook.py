"""Export an R24 question draft as a single-sheet Excel assignment."""
import argparse
import json
import math
import re
import unicodedata
from pathlib import Path

import xlsxwriter


def text_field(value, minimum, maximum, label):
    if not isinstance(value, str):
        raise ValueError(f"{label}须为文字")
    text = value.strip()
    if not minimum <= len(text.encode("utf-16-le")) // 2 <= maximum:
        raise ValueError(f"{label}须含 {minimum} 至 {maximum} 个字符")
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]", text):
        raise ValueError(f"{label}含无效控制符")
    return text


def display_lines(text, width):
    lines = 0
    for line in text.splitlines():
        characters = sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in line)
        lines += max(1, math.ceil(characters / (width - 5)))
    return lines


def export_excel(draft_path, output_path):
    draft = json.loads(draft_path.read_text(encoding="utf-8-sig"))
    if not isinstance(draft, dict) or set(draft) != {"questions"}:
        raise ValueError("JSON 须为含 questions 数组的对象")
    questions = draft["questions"]
    if not isinstance(questions, list) or not 1 <= len(questions) <= 20:
        raise ValueError("R24 草稿须含 1 至 20 道题")

    # R24 splits Excel scoring cells on commas, semicolons and LF. Their small
    # typographic variants keep punctuation inside a single point readable.
    punctuation = str.maketrans({",": "﹐", "，": "﹐", "、": "﹑", ";": "﹔", "；": "﹔"})
    rows = []
    adapted_count = 0
    point_count = 0
    for index, row in enumerate(questions, 1):
        if not isinstance(row, dict) or set(row) != {"question", "answer", "keyPoints"}:
            raise ValueError(f"第{index}题须含 question、answer、keyPoints")
        question = text_field(row["question"], 2, 500, "题目")
        answer = text_field(row["answer"], 2, 3000, "参考答案")
        points = row["keyPoints"]
        if not isinstance(points, list) or not 1 <= len(points) <= 12:
            raise ValueError(f"第{index}题须含 1 至 12 条评分要点")
        display_points = []
        for point in points:
            point = text_field(point, 1, 200, "评分要点")
            display = re.sub(r"[\r\n]+", " ", point).translate(punctuation)
            adapted_count += display != point
            display_points.append(display)
        point_count += len(points)
        rows.append((question, answer, "；".join(display_points)))

    widths = (51, 88, 52)
    with xlsxwriter.Workbook(str(output_path)) as workbook:
        sheet = workbook.add_worksheet("练播作业")
        sheet.freeze_panes(1, 1)
        sheet.hide_gridlines(2)
        header = workbook.add_format({"bold": True, "font_color": "#FFFFFF", "bg_color": "#173758",
                                      "font_size": 12, "valign": "vcenter", "indent": 1})
        body = [workbook.add_format({"font_name": "Microsoft YaHei", "font_size": 11,
                                     "font_color": "#172F46", "bg_color": color,
                                     "valign": "vcenter", "text_wrap": True, "num_format": "@"})
                for color in ("#FFFFFF", "#EEF4F8")]
        for column, title in enumerate(("题目", "参考答案", "评分要点")):
            sheet.set_column(column, column, widths[column])
            sheet.write_string(0, column, title, header)
        sheet.set_row(0, 28)
        for number, cells in enumerate(rows, 1):
            height = max(display_lines(value, width) for value, width in zip(cells, widths))
            sheet.set_row(number, min(409, 12 + 19 * height))
            for column, value in enumerate(cells):
                # Explicit strings preserve leading =, +, -, @ and URLs as text.
                sheet.write_string(number, column, value, body[(number - 1) % 2])
        sheet.autofilter(0, 0, len(rows), 2)
    print(f"已导出 {len(rows)} 题、{point_count} 条要点。为保留导入后的要点条数，已调整 {adapted_count} 条要点内的分隔标点或换行。")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("draft", type=Path)
    parser.add_argument("workbook", type=Path)
    args = parser.parse_args()
    export_excel(args.draft, args.workbook)
