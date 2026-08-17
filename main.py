import os
import sys
import webview
from api import Api
from utils import get_web_dir


def main():
    api = Api()
    web_dir = get_web_dir()
    index_path = os.path.join(web_dir, 'index.html')

    window = webview.create_window(
        'YouTube Fetcher',
        url=index_path,
        js_api=api,
        width=860,
        height=650,
        min_size=(720, 420),
        background_color='#111827',
        text_select=True,
    )
    api.set_window(window)

    webview.start(debug=('--debug' in sys.argv))


if __name__ == '__main__':
    main()
