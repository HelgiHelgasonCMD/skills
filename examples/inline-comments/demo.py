# inline-comments: skip-in-repo-scan
# Demo for the inline-comments skill. Open this file and tell Claude: "do my comments in examples/inline-comments/demo.py"
import json
import urllib.request


def fetch_user(user_id):
    # @claude add a 5 second timeout and raise a clear error on HTTP failure
    with urllib.request.urlopen(f"https://api.example.com/users/{user_id}") as r:
        return json.load(r)


def full_name(user):
    return user["first"] + " " + user["last"]  # @claude handle a missing "last" key


def greeting(user):
    # @claude? why would this break for users with no name at all
    return "Hello, " + full_name(user)
