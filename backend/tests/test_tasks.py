URL = "/api/v1/tasks"


def test_task_crud(client):
    res = client.post(
        URL, json={"title": "Write report", "priority": "high", "due_date": "2026-12-01"}
    )
    assert res.status_code == 201
    task = res.json()
    assert task["status"] == "todo"
    assert task["priority"] == "high"

    res = client.get(f"{URL}/{task['id']}")
    assert res.status_code == 200
    assert res.json()["title"] == "Write report"

    res = client.patch(f"{URL}/{task['id']}", json={"status": "done"})
    assert res.status_code == 200
    assert res.json()["status"] == "done"
    assert res.json()["title"] == "Write report"

    assert client.delete(f"{URL}/{task['id']}").status_code == 204
    assert client.get(f"{URL}/{task['id']}").status_code == 404


def test_list_filters_and_pagination(client):
    for title, priority in [("a", "low"), ("b", "high"), ("c", "high")]:
        client.post(URL, json={"title": title, "priority": priority})

    res = client.get(URL, params={"priority": "high"})
    assert [t["title"] for t in res.json()] == ["c", "b"]

    res = client.get(URL, params={"limit": 1, "skip": 1})
    assert len(res.json()) == 1


def test_validation_errors(client):
    assert client.post(URL, json={"title": ""}).status_code == 422
    assert client.post(URL, json={"title": "x", "status": "bogus"}).status_code == 422
    created = client.post(URL, json={"title": "x"}).json()
    assert client.patch(f"{URL}/{created['id']}", json={"title": None}).status_code == 422
    assert client.get(URL, params={"limit": 1000}).status_code == 422


def test_not_found(client):
    assert client.get(f"{URL}/999").status_code == 404
    assert client.patch(f"{URL}/999", json={"title": "x"}).status_code == 404
    assert client.delete(f"{URL}/999").status_code == 404
