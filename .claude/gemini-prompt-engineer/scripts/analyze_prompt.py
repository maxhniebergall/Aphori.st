#!/usr/bin/env python3
"""
Gemini Prompt Analysis Tool

Analyzes a Gemini prompt against best practices and generates an improvement report.

Usage:
    python analyze_prompt.py <prompt_file> [--output report.md]
"""

import sys
import re
import json
from pathlib import Path
from typing import List, Dict, Any
from dataclasses import dataclass


@dataclass
class PromptIssue:
    """Represents an issue found in the prompt"""
    severity: str  # 'critical', 'warning', 'suggestion'
    category: str
    message: str
    line_number: int = 0


class GeminiPromptAnalyzer:
    """Analyzes Gemini prompts for best practices compliance"""

    def __init__(self, prompt_text: str, has_schema: bool = False):
        self.prompt = prompt_text
        self.has_schema = has_schema
        self.issues: List[PromptIssue] = []
        self.strengths: List[str] = []

    def analyze(self) -> Dict[str, Any]:
        """Run all analysis checks"""
        self._check_goal_clarity()
        self._check_output_specification()
        self._check_few_shot_examples()
        self._check_temperature_mention()
        self._check_quality_gates()
        self._check_confidence_scoring()
        self._check_coreference_instructions()
        self._check_visual_markers()
        self._check_schema_usage()

        return {
            'issues': self.issues,
            'strengths': self.strengths,
            'score': self._calculate_score()
        }

    def _check_goal_clarity(self):
        """Check if the prompt has clear goal/objective"""
        goal_keywords = ['task:', 'goal:', 'objective:', 'your role:', 'you are']

        if any(keyword in self.prompt.lower() for keyword in goal_keywords):
            self.strengths.append("Clear goal/objective statement present")
        else:
            self.issues.append(PromptIssue(
                severity='warning',
                category='Goal Clarity',
                message='No clear goal or objective statement found. Consider adding "TASK:" or "GOAL:" section'
            ))

    def _check_output_specification(self):
        """Check if output format is specified"""
        format_keywords = ['format:', 'output format:', 'json', 'structure:']

        if any(keyword in self.prompt.lower() for keyword in format_keywords):
            self.strengths.append("Output format specification present")
        else:
            self.issues.append(PromptIssue(
                severity='warning',
                category='Output Specification',
                message='Output format not explicitly specified. Add "OUTPUT FORMAT:" section'
            ))

    def _check_few_shot_examples(self):
        """Check for few-shot examples"""
        example_patterns = [
            r'example\s+\d+:',
            r'example:',
            r'input:.*output:',
        ]

        has_examples = any(re.search(pattern, self.prompt.lower()) for pattern in example_patterns)

        if has_examples:
            # Count examples
            example_count = len(re.findall(r'example\s+\d+:', self.prompt.lower()))
            if example_count == 0:
                example_count = len(re.findall(r'example:', self.prompt.lower()))

            if 2 <= example_count <= 5:
                self.strengths.append(f"Good number of few-shot examples ({example_count})")
            elif example_count == 1:
                self.issues.append(PromptIssue(
                    severity='suggestion',
                    category='Few-Shot Examples',
                    message='Only 1 example found. Gemini documentation recommends 2-5 examples'
                ))
            elif example_count > 5:
                self.issues.append(PromptIssue(
                    severity='suggestion',
                    category='Few-Shot Examples',
                    message=f'{example_count} examples found. Consider reducing to 2-5 for efficiency'
                ))
        else:
            self.issues.append(PromptIssue(
                severity='critical',
                category='Few-Shot Examples',
                message='No few-shot examples found. Gemini documentation: "Always include few-shot examples"'
            ))

    def _check_temperature_mention(self):
        """Check if temperature=0 is mentioned for deterministic tasks"""
        if 'extract' in self.prompt.lower() or 'data' in self.prompt.lower():
            if 'temperature' not in self.prompt.lower():
                self.issues.append(PromptIssue(
                    severity='suggestion',
                    category='Generation Config',
                    message='For data extraction, recommend setting temperature=0 for deterministic output'
                ))

    def _check_quality_gates(self):
        """Check for quality assessment gates"""
        quality_patterns = [
            'quality assessment',
            'canprocess',
            'can process',
            'assess.*quality',
            'before extracting'
        ]

        has_quality_gate = any(re.search(pattern, self.prompt.lower()) for pattern in quality_patterns)

        if has_quality_gate:
            self.strengths.append("Quality assessment gate implemented")
        else:
            self.issues.append(PromptIssue(
                severity='warning',
                category='Quality Gates',
                message='No quality assessment gate found. Consider adding canProcess check before extraction'
            ))

    def _check_confidence_scoring(self):
        """Check for confidence scoring instructions"""
        confidence_keywords = ['confidence', 'confidence score', 'confidence level']

        has_confidence = any(keyword in self.prompt.lower() for keyword in confidence_keywords)

        if has_confidence:
            # Check if scoring guidelines are provided
            if re.search(r'0\.\d+-\d\.\d+:', self.prompt):
                self.strengths.append("Confidence scoring with detailed guidelines")
            else:
                self.strengths.append("Confidence scoring mentioned")
                self.issues.append(PromptIssue(
                    severity='suggestion',
                    category='Confidence Scoring',
                    message='Confidence mentioned but no scoring guidelines (0.0-1.0 ranges). Add examples'
                ))
        elif self.has_schema:
            self.issues.append(PromptIssue(
                severity='warning',
                category='Confidence Scoring',
                message='No confidence scoring instructions. Add guidelines for 0.0-1.0 scale'
            ))

    def _check_coreference_instructions(self):
        """Check for coreference resolution instructions"""
        coreference_keywords = [
            'coreference',
            'demonstrative',
            'this/that',
            'resolve.*pronouns',
            'temporal.*context'
        ]

        has_coreference = any(re.search(keyword, self.prompt.lower()) for keyword in coreference_keywords)

        # Only flag if prompt seems conversational/narrative
        if 'audio' in self.prompt.lower() or 'conversation' in self.prompt.lower():
            if has_coreference:
                self.strengths.append("Coreference resolution instructions included")
            else:
                self.issues.append(PromptIssue(
                    severity='suggestion',
                    category='Coreference Resolution',
                    message='Conversational/audio input detected. Consider adding coreference resolution instructions'
                ))

    def _check_visual_markers(self):
        """Check for visual emphasis markers"""
        visual_markers = ['⚠️', '**critical**', '**important**', 'critical:', 'important:']

        has_markers = any(marker in self.prompt.lower() for marker in visual_markers)

        if has_markers:
            self.strengths.append("Visual emphasis markers used for critical instructions")
        else:
            self.issues.append(PromptIssue(
                severity='suggestion',
                category='Visual Emphasis',
                message='No visual markers (⚠️, **CRITICAL**) found. Use for important instructions'
            ))

    def _check_schema_usage(self):
        """Check if structured output schema is mentioned"""
        if not self.has_schema:
            self.issues.append(PromptIssue(
                severity='critical',
                category='Structured Output',
                message='No responseSchema detected. Use responseSchema with responseMimeType: "application/json"'
            ))
        else:
            self.strengths.append("Structured output schema (responseSchema) used")

    def _calculate_score(self) -> int:
        """Calculate overall prompt quality score (0-100)"""
        total_points = 100

        for issue in self.issues:
            if issue.severity == 'critical':
                total_points -= 20
            elif issue.severity == 'warning':
                total_points -= 10
            elif issue.severity == 'suggestion':
                total_points -= 5

        return max(0, min(100, total_points))

    def generate_report(self) -> str:
        """Generate a markdown analysis report"""
        score = self._calculate_score()

        report = f"""# Gemini Prompt Analysis Report

## Overall Score: {score}/100

{'🟢 Excellent' if score >= 80 else '🟡 Good' if score >= 60 else '🟠 Needs Improvement' if score >= 40 else '🔴 Critical Issues'}

---

## Strengths ✅

"""
        if self.strengths:
            for strength in self.strengths:
                report += f"- {strength}\n"
        else:
            report += "*No significant strengths identified*\n"

        report += "\n---\n\n## Issues Found\n\n"

        if self.issues:
            # Group by severity
            critical = [i for i in self.issues if i.severity == 'critical']
            warnings = [i for i in self.issues if i.severity == 'warning']
            suggestions = [i for i in self.issues if i.severity == 'suggestion']

            if critical:
                report += "### 🔴 Critical Issues\n\n"
                for issue in critical:
                    report += f"**{issue.category}**: {issue.message}\n\n"

            if warnings:
                report += "### 🟡 Warnings\n\n"
                for issue in warnings:
                    report += f"**{issue.category}**: {issue.message}\n\n"

            if suggestions:
                report += "### 💡 Suggestions\n\n"
                for issue in suggestions:
                    report += f"**{issue.category}**: {issue.message}\n\n"
        else:
            report += "*No issues found* ✨\n"

        report += """
---

## Recommended Next Steps

1. Address all critical issues first (20 points each)
2. Fix warnings for better prompt quality (10 points each)
3. Consider suggestions for optimization (5 points each)
4. Test prompt with real examples and iterate
5. Run validation again after improvements

## Best Practices Checklist

- [ ] Clear goal/objective defined
- [ ] Output format explicitly specified
- [ ] 2-5 few-shot examples included
- [ ] temperature=0 for deterministic extraction
- [ ] Quality assessment gate (canProcess check)
- [ ] Confidence scoring with 0.0-1.0 guidelines
- [ ] Visual markers (⚠️, **CRITICAL**) for important steps
- [ ] Coreference resolution (for conversational inputs)
- [ ] responseSchema with responseMimeType configured
- [ ] Required fields marked in schema

"""
        return report


def main():
    """Main entry point"""
    if len(sys.argv) < 2:
        print("Usage: python analyze_prompt.py <prompt_file> [--output report.md]")
        sys.exit(1)

    prompt_file = Path(sys.argv[1])
    output_file = None

    if '--output' in sys.argv:
        output_index = sys.argv.index('--output')
        if len(sys.argv) > output_index + 1:
            output_file = Path(sys.argv[output_index + 1])

    if not prompt_file.exists():
        print(f"Error: File not found: {prompt_file}")
        sys.exit(1)

    # Read prompt
    prompt_text = prompt_file.read_text()

    # Check if there's a corresponding schema file
    has_schema = False
    schema_file = prompt_file.with_suffix('.schema.json')
    if schema_file.exists():
        has_schema = True
        print(f"📋 Found schema file: {schema_file}")

    # Check if responseSchema is mentioned in prompt
    if 'responseschema' in prompt_text.lower() or 'responsemimetype' in prompt_text.lower():
        has_schema = True

    # Analyze
    print(f"🔍 Analyzing prompt: {prompt_file}")
    analyzer = GeminiPromptAnalyzer(prompt_text, has_schema=has_schema)
    results = analyzer.analyze()

    # Generate report
    report = analyzer.generate_report()

    # Output
    if output_file:
        output_file.write_text(report)
        print(f"✅ Report saved to: {output_file}")
    else:
        print(report)

    # Print summary
    score = results['score']
    print(f"\n{'='*60}")
    print(f"Final Score: {score}/100")
    print(f"Issues: {len(results['issues'])} ({sum(1 for i in results['issues'] if i.severity == 'critical')} critical)")
    print(f"Strengths: {len(results['strengths'])}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
