"""Courses storage and management for SourceWise."""
import json
import os
import re
import threading
import time
import uuid

COURSES_FILE = "data/courses.json"
_lock = threading.RLock()

DEFAULT_COURSE_ID = "default"
DEFAULT_COURSE_NAME = os.getenv("COURSE_NAME", "MIT 6.0001: Introduction to Computer Science")
DEFAULT_COURSE_DESC = "Core course materials (Python, Recursion, Dictionaries)"


def _ensure_dir():
    os.makedirs(os.path.dirname(COURSES_FILE), exist_ok=True)


def _load_unlocked():
    _ensure_dir()
    courses = []
    if os.path.exists(COURSES_FILE):
        try:
            with open(COURSES_FILE, "r", encoding="utf-8") as f:
                courses = json.load(f)
        except Exception:
            courses = []

    has_default = any(c.get("id") == DEFAULT_COURSE_ID for c in courses)
    if not has_default:
        courses.insert(0, {
            "id": DEFAULT_COURSE_ID,
            "name": DEFAULT_COURSE_NAME,
            "description": DEFAULT_COURSE_DESC,
            "created": 1728900000.0,
        })
        with open(COURSES_FILE, "w", encoding="utf-8") as f:
            json.dump(courses, f, indent=2)
    return courses


def init_courses():
    """Ensure data/courses.json exists with the default course."""
    with _lock:
        return _load_unlocked()


def list_courses():
    """Return all courses, ensuring default course exists."""
    with _lock:
        return _load_unlocked()


def get_course(course_id: str):
    """Get a course by ID."""
    with _lock:
        courses = _load_unlocked()
        for c in courses:
            if c.get("id") == course_id:
                return c
        return None


def get_course_name(course_id: str | None) -> str:
    """Return human readable course name for a course ID."""
    if not course_id or course_id == "all":
        return "All Courses"
    course = get_course(course_id)
    return course["name"] if course else "Course"


def create_course(name: str, description: str = ""):
    """Create a new course with a unique ID."""
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Course name cannot be empty")

    slug = re.sub(r"[^a-zA-Z0-9]+", "-", clean_name.lower()).strip("-")[:24]
    unique_suffix = uuid.uuid4().hex[:6]
    course_id = f"course-{slug}-{unique_suffix}" if slug else f"course-{unique_suffix}"

    new_course = {
        "id": course_id,
        "name": clean_name,
        "description": description.strip(),
        "created": time.time(),
    }

    with _lock:
        courses = _load_unlocked()
        courses.append(new_course)
        with open(COURSES_FILE, "w", encoding="utf-8") as f:
            json.dump(courses, f, indent=2)

    return new_course


def delete_course(course_id: str):
    """Delete a course from courses.json (cannot delete default course)."""
    if course_id == DEFAULT_COURSE_ID:
        raise ValueError("Cannot delete the default course")

    with _lock:
        courses = _load_unlocked()
        new_courses = [c for c in courses if c.get("id") != course_id]
        if len(new_courses) == len(courses):
            return False
        with open(COURSES_FILE, "w", encoding="utf-8") as f:
            json.dump(new_courses, f, indent=2)
        return True
